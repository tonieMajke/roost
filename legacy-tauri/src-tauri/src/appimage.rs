//! Uruchomiona z AppImage aplikacja ma środowisko AppRun (`LD_LIBRARY_PATH`, `PATH`,
//! `PYTHONHOME`… wskazujące na zamontowany `$APPDIR`). Agenci i powłoki w panelach
//! nie mogą go dziedziczyć: python, perl i programy z systemowymi bibliotekami się sypią.

/// Ustawiane przez runtime/AppRun bez odwołania do `$APPDIR` w wartości.
const APPIMAGE_ONLY: [&str; 6] = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "PYTHONDONTWRITEBYTECODE", "GTK_THEME"];

/// Poprawki środowiska dziecka: (zmienne do usunięcia, zmienne do nadpisania).
/// Listy `a:b:c` tracą wpisy z `$APPDIR`; zmienna bez innych wpisów znika.
/// Poza AppImage (brak `APPDIR`/`APPIMAGE`) nic nie zmienia.
pub fn child_env_fixes<I>(vars: I) -> (Vec<String>, Vec<(String, String)>)
where
    I: IntoIterator<Item = (String, String)>,
{
    let vars: Vec<(String, String)> = vars.into_iter().collect();
    let get = |k: &str| vars.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
    let appdir = match (get("APPDIR"), get("APPIMAGE")) {
        (Some(dir), Some(_)) if dir.len() > 1 => dir.trim_end_matches('/').to_string(),
        _ => return (Vec::new(), Vec::new()),
    };
    let mut remove = Vec::new();
    let mut set = Vec::new();
    for (key, value) in &vars {
        if APPIMAGE_ONLY.contains(&key.as_str()) {
            remove.push(key.clone());
        } else if value.contains(&appdir) {
            let kept: Vec<&str> = value.split(':').filter(|p| !p.is_empty() && !p.contains(&appdir)).collect();
            if kept.is_empty() {
                remove.push(key.clone());
            } else {
                set.push((key.clone(), kept.join(":")));
            }
        }
    }
    (remove, set)
}

/// `child_env_fixes` dla środowiska tego procesu.
pub fn current_fixes() -> (Vec<String>, Vec<(String, String)>) {
    child_env_fixes(std::env::vars())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn outside_appimage_nothing_changes() {
        let (remove, set) = child_env_fixes(env(&[("PATH", "/usr/bin"), ("GTK_THEME", "Breeze")]));
        assert!(remove.is_empty() && set.is_empty());
        // samo APPDIR (np. inny program) to jeszcze nie AppImage
        let (remove, set) = child_env_fixes(env(&[("APPDIR", "/tmp/.mount_x"), ("PATH", "/tmp/.mount_x/usr/bin:/usr/bin")]));
        assert!(remove.is_empty() && set.is_empty());
    }

    #[test]
    fn strips_appdir_entries_and_appimage_vars() {
        let d = "/tmp/.mount_AgentsX";
        let (mut remove, mut set) = child_env_fixes(env(&[
            ("APPDIR", d),
            ("APPIMAGE", "/home/u/.local/bin/Agents.AppImage"),
            ("OWD", "/home/u"),
            ("GTK_THEME", "Adwaita:dark"),
            ("PYTHONDONTWRITEBYTECODE", "1"),
            ("PATH", "/tmp/.mount_AgentsX/usr/bin/:/tmp/.mount_AgentsX/bin/:/home/u/.cargo/bin:/usr/bin"),
            ("LD_LIBRARY_PATH", "/tmp/.mount_AgentsX/usr/lib/:/tmp/.mount_AgentsX/usr/lib64"),
            ("PYTHONHOME", "/tmp/.mount_AgentsX/usr/"),
            ("PYTHONPATH", "/tmp/.mount_AgentsX/usr/share/pyshared/:"),
            ("XDG_DATA_DIRS", "/tmp/.mount_AgentsX/usr/share/:/usr/share:/usr/local/share"),
            ("HOME", "/home/u"),
            ("GTK_RC_FILES", "/etc/gtk/gtkrc"),
        ]));
        remove.sort();
        set.sort();
        assert_eq!(
            remove,
            ["APPDIR", "APPIMAGE", "GTK_THEME", "LD_LIBRARY_PATH", "OWD", "PYTHONDONTWRITEBYTECODE", "PYTHONHOME", "PYTHONPATH"]
        );
        assert_eq!(
            set,
            env(&[("PATH", "/home/u/.cargo/bin:/usr/bin"), ("XDG_DATA_DIRS", "/usr/share:/usr/local/share")])
        );
    }
}
