//! 실행 파일 위치로 결정하는 설치판·저장소 경로와 설치판 엔진 교체.
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::{
    account_sync::{COOKIE_FILE, PROFILES_SUBDIR},
    capture, engine,
};

pub fn search_dirs() -> Vec<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_owned))
        .into_iter()
        .collect()
}

#[derive(Debug, PartialEq)]
pub enum Layout {
    Repository(PathBuf),
    Installed,
}

impl Layout {
    pub fn classify(repository: Option<PathBuf>) -> Self {
        repository.map_or(Self::Installed, Self::Repository)
    }

    pub fn detect(dirs: &[PathBuf]) -> Self {
        let root = capture::find_repo_root(dirs).or_else(|| {
            engine::find_engine_dir(dirs)?
                .parent()?
                .parent()
                .map(Path::to_owned)
        });
        Self::classify(root)
    }

    pub fn current_data(&self) -> Option<PathBuf> {
        self.data(|key| std::env::var(key).ok())
    }

    pub fn extension_dir(&self, resources: Option<PathBuf>) -> Result<PathBuf, String> {
        let root = match self {
            Self::Repository(root) => root.clone(),
            Self::Installed => resources.ok_or("앱 설치 폴더를 찾을 수 없다")?,
        };
        let folder = root.join("extension");
        if !folder.join("manifest.json").is_file() {
            return Err("확장 폴더에 설치 정보가 없다. 앱 설치 상태를 확인해 주세요.".into());
        }
        Ok(folder)
    }

    pub fn data(&self, env: impl Fn(&str) -> Option<String>) -> Option<PathBuf> {
        match self {
            Self::Repository(root) => Some(root.join("data")),
            Self::Installed => env("APPDATA")
                .filter(|s| !s.trim().is_empty())
                .map(|p| PathBuf::from(p).join("nikke-companion")),
        }
    }
}

pub fn data_folder(
    env: impl Fn(&str) -> Option<String>,
    dirs: &[PathBuf],
    key: &str,
    name: &str,
) -> Option<PathBuf> {
    env(key)
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| Layout::detect(dirs).data(env).map(|data| data.join(name)))
}

const MARKER: &str = ".companion-version";
static COPY_LOCK: Mutex<()> = Mutex::new(());

fn copy_tree(source: &Path, dest: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::create_dir(dest)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dest.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        fs::copy(source, dest)?;
    } else {
        return Err(io::Error::other("일반 파일이나 폴더가 아니다"));
    }
    Ok(())
}

fn remove_scratch(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

/// 중단된 교체는 다음 실행에서도 되돌릴 수 있다. 개인 파일은 같은 볼륨에서 이름만 바꾼다.
fn move_saved(from: &Path, to: &Path) -> io::Result<()> {
    for name in [COOKIE_FILE, PROFILES_SUBDIR] {
        let saved = from.join(name);
        if saved.try_exists()? {
            let target = to.join(name);
            if target.try_exists()? {
                return Err(io::Error::other("보관한 계정 자료가 이미 있다"));
            }
            fs::rename(saved, target)?;
        }
    }
    Ok(())
}

fn overlapping_dirs(first: &Path, second: &Path) -> bool {
    // 폴더 이름 전체를 비교하므로 이름의 앞부분만 같은 이웃 폴더는 허용한다.
    let first = PathBuf::from(first.to_string_lossy().to_lowercase());
    let second = PathBuf::from(second.to_string_lossy().to_lowercase());
    first.starts_with(&second) || second.starts_with(&first)
}

fn resolved_dir(path: &Path) -> io::Result<PathBuf> {
    match fs::canonicalize(path) {
        // 첫 실행에는 데이터 폴더가 없다. 존재하는 상위 폴더의 실제 위치에 남은 이름을 붙인다.
        Err(e) if e.kind() == io::ErrorKind::NotFound => match (path.parent(), path.file_name()) {
            (Some(parent), Some(name)) => Ok(resolved_dir(parent)?.join(name)),
            _ => Err(e),
        },
        result => result,
    }
}

fn prepare_engine(resources: &Path, data: &Path, version: &str, old: &Path) -> io::Result<PathBuf> {
    let resource = resources.join("engine");
    let engine = data.join("engine");
    if overlapping_dirs(
        &std::path::absolute(resources)?,
        &std::path::absolute(data)?,
    ) || overlapping_dirs(&resolved_dir(resources)?, &resolved_dir(data)?)
        || (engine.try_exists()?
            && resource.try_exists()?
            && same_file::is_same_file(&resource, &engine)?)
    {
        return Err(io::Error::other(
            "사용자 데이터와 설치 위치가 겹친다. 앱을 다른 폴더에 다시 설치해 주세요",
        ));
    }
    let stage = data.join(".engine-staging");
    fs::create_dir_all(data)?;
    // 두 이름을 바꾸는 사이 전원이 꺼졌으면 마지막으로 완성된 엔진을 먼저 되돌린다.
    if !engine.try_exists()? && old.try_exists()? {
        move_saved(&stage, old)?;
        fs::rename(old, &engine)?;
    }
    if engine.join("runner/sim.py").is_file()
        && fs::read_to_string(engine.join(MARKER)).ok().as_deref() == Some(version)
    {
        let _ = remove_scratch(&stage);
        return Ok(engine);
    }
    remove_scratch(old)?;
    remove_scratch(&stage)?;
    if !resource.join("runner/sim.py").is_file()
        || !resource.join("scraper/profile_fetch.py").is_file()
        || resource.join(COOKIE_FILE).try_exists()?
        || resource.join(PROFILES_SUBDIR).try_exists()?
    {
        return Err(io::Error::other("설치 프로그램의 엔진 구성이 잘못됐다"));
    }
    copy_tree(&resource, &stage)?;
    fs::write(stage.join(MARKER), version)?;
    let had_engine = engine.try_exists()?;
    if had_engine {
        fs::rename(&engine, old)?;
    }
    let activate = || {
        if had_engine {
            move_saved(old, &stage)?;
        }
        fs::rename(&stage, &engine)
    };
    if let Err(e) = activate() {
        if had_engine {
            move_saved(&stage, old)?;
            fs::rename(old, &engine)?;
        }
        return Err(e);
    }
    Ok(engine)
}

pub fn installed_engine(resources: &Path, data: &Path, version: &str) -> Result<PathBuf, String> {
    let _guard = COPY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old = data.join(".engine-previous");
    let engine = prepare_engine(resources, data, version, &old).map_err(|e| {
        format!("계산 도구를 준비하지 못했다. 설치 프로그램을 다시 실행해 주세요 ({e}).")
    })?;
    // 현재 판을 준비한 뒤에는 이전 파일이 잠겨 있어도 다음 호출에서 정리를 다시 시도할 수 있다.
    let _ = remove_scratch(&old);
    Ok(engine)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extension_folder_uses_the_selected_layout_and_checks_the_manifest() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        let resources = temp.path().join("bundle");
        for root in [&repo, &resources] {
            fs::create_dir_all(root.join("extension")).unwrap();
        }
        for (layout, root) in [(Layout::Repository(repo.clone()), repo), (Layout::Installed, resources.clone())] {
            let resolve = || layout.extension_dir(Some(resources.clone()));
            assert!(resolve().unwrap_err().contains("설치 정보"));
            fs::write(root.join("extension/manifest.json"), "{}").unwrap();
            assert_eq!(resolve().unwrap(), root.join("extension"));
        }
    }
    #[test]
    fn installation_uses_only_the_executable_location() {
        let root = PathBuf::from("repo");
        assert_eq!(
            Layout::classify(Some(root.clone())),
            Layout::Repository(root)
        );
        assert_eq!(Layout::classify(None), Layout::Installed);
        assert_eq!(
            Layout::Installed.data(|_| Some("roaming".into())),
            Some(PathBuf::from("roaming/nikke-companion"))
        );
    }

    #[test]
    fn installed_data_and_overrides_are_independent_of_the_launch_directory() {
        let temp = tempfile::tempdir().unwrap();
        let bin = temp.path().join("Programs/nikke-companion");
        let appdata = temp.path().join("roaming");
        let env = |key: &str| (key == "APPDATA").then(|| appdata.to_string_lossy().into_owned());
        let dirs = [bin];
        let data = appdata.join("nikke-companion");
        assert_eq!(
            crate::account_sync::resolve_accounts_dir(env, &dirs).unwrap(),
            data.join("accounts")
        );
        assert_eq!(
            capture::resolve_capture_dir(env, &dirs).unwrap(),
            data.join("captures")
        );
        let explicit = temp.path().join("custom");
        let env = |_: &str| Some(explicit.to_string_lossy().into_owned());
        assert_eq!(capture::resolve_capture_dir(env, &dirs).unwrap(), explicit);
        assert_eq!(
            crate::account_sync::resolve_accounts_dir(env, &dirs).unwrap(),
            explicit
        );
    }

    #[test]
    fn engine_upgrade_keeps_user_data_and_recovers_after_interruption() {
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("bundle");
        let resource = resources.join("engine");
        let data = temp.path().join("bundle-data");
        for name in ["runner/sim.py", "scraper/profile_fetch.py"] {
            let file = resource.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, "first").unwrap();
        }
        let install = |v| installed_engine(&resources, &data, v);
        let engine = install("1").unwrap();
        fs::write(resource.join("runner/sim.py"), "next").unwrap();
        fs::write(engine.join(COOKIE_FILE), "test-only").unwrap();
        fs::create_dir(engine.join(PROFILES_SUBDIR)).unwrap();
        fs::write(engine.join("profiles/sample.json"), "{}").unwrap();
        install("1").unwrap();
        assert_eq!(fs::read(engine.join("runner/sim.py")).unwrap(), b"first");
        install("2").unwrap();
        assert_eq!(fs::read(engine.join("runner/sim.py")).unwrap(), b"next");
        assert_eq!(fs::read(engine.join(COOKIE_FILE)).unwrap(), b"test-only");
        assert_eq!(
            fs::read(engine.join("profiles/sample.json")).unwrap(),
            b"{}"
        );
        fs::rename(&engine, data.join(".engine-previous")).unwrap();
        let stage = data.join(".engine-staging");
        fs::create_dir_all(stage.join("scraper")).unwrap();
        fs::rename(
            data.join(".engine-previous").join(COOKIE_FILE),
            stage.join(COOKIE_FILE),
        )
        .unwrap();
        fs::remove_file(resource.join("scraper/profile_fetch.py")).unwrap();
        assert!(install("3").is_err());
        assert_eq!(fs::read(engine.join(MARKER)).unwrap(), b"2");
        assert_eq!(fs::read(engine.join(COOKIE_FILE)).unwrap(), b"test-only");
    }

    #[test]
    fn overlapping_engine_paths_leave_both_versions_and_staging_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path();
        let engine = data.join("engine");
        fs::create_dir_all(engine.join("runner")).unwrap();
        fs::write(engine.join("runner/sim.py"), "original").unwrap();
        fs::write(engine.join(MARKER), "1").unwrap();
        let stage = data.join(".engine-staging");
        fs::create_dir(&stage).unwrap();
        for resources in [data, &engine, &engine.join("runner/..")] {
            for version in ["1", "2"] {
                let err = installed_engine(resources, data, version).unwrap_err();
                assert!(err.contains("다른 폴더에 다시 설치"));
                assert_eq!(fs::read(engine.join(MARKER)).unwrap(), b"1");
                assert_eq!(fs::read(engine.join("runner/sim.py")).unwrap(), b"original");
                assert!(stage.is_dir());
            }
        }
    }

    #[test]
    fn installation_under_data_survives_the_first_run() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("roaming");
        for parent in ["apps", ".engine-staging", ".engine-previous"] {
            let resources = data.join(parent).join("companion");
            fs::create_dir_all(resources.join("engine/runner")).unwrap();
            let bundled = resources.join("engine/runner/sim.py");
            fs::write(&bundled, "original").unwrap();
            let err = installed_engine(&resources, &data, "1").unwrap_err();
            assert!(err.contains("다른 폴더에 다시 설치"));
            assert_eq!(fs::read(bundled).unwrap(), b"original");
            assert!(!data.join("engine").exists());
        }
    }

    #[test]
    fn data_under_installation_is_rejected_before_creation() {
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("bundle");
        fs::create_dir_all(resources.join("engine")).unwrap();
        let data = resources.join("roaming/nikke-companion");
        let err = installed_engine(&resources, &data, "1").unwrap_err();
        assert!(err.contains("다른 폴더에 다시 설치"));
        assert!(!resources.join("roaming").exists());
    }

    #[cfg(windows)]
    #[test]
    fn overlap_ignores_windows_case_and_separator_spelling() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("Data");
        let resources = data.join(".engine-staging").join("Companion");
        fs::create_dir_all(&resources).unwrap();
        let alternate = temp.path().join(r"dAtA/.ENGINE-staging\companion");
        assert!(installed_engine(&alternate, &data, "1")
            .unwrap_err()
            .contains("다른 폴더에 다시 설치"));
        assert!(resources.is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn current_engine_survives_locked_previous_directory() {
        use std::os::windows::fs::OpenOptionsExt;

        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("bundle");
        let resource = resources.join("engine");
        let data = temp.path().join("roaming");
        let install = |v| installed_engine(&resources, &data, v);
        for name in ["runner/sim.py", "scraper/profile_fetch.py"] {
            let file = resource.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, "first").unwrap();
        }
        let engine = install("1").unwrap();
        let previous = data.join(".engine-previous");
        fs::write(resource.join("runner/sim.py"), "next").unwrap();
        install("2").unwrap();
        // 새 판이 활성화된 뒤 이전 폴더에 다른 프로그램이 열고 있는 파일이 남은 상태다.
        fs::create_dir_all(previous.join("runner")).unwrap();
        let leftover = previous.join("runner/sim.py");
        fs::write(&leftover, "first").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&leftover)
            .unwrap();
        for _ in 0..2 {
            assert_eq!(install("2").unwrap(), engine);
            assert_eq!(fs::read(engine.join("runner/sim.py")).unwrap(), b"next");
            assert!(leftover.is_file());
        }
        drop(lock);
        assert_eq!(install("2").unwrap(), engine);
        assert!(!previous.exists());
    }
}
