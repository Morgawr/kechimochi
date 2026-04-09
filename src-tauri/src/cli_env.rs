use std::ffi::OsString;

const CLI_ENV_PREFIX: &str = "--kechimochi-env=";
const ENV_NAME_PREFIX: &str = "KECHIMOCHI_";

pub fn apply_cli_env_overrides() {
    for (key, value) in parse_cli_env_overrides(std::env::args_os().skip(1)) {
        std::env::set_var(key, value);
    }
}

fn parse_cli_env_overrides<I, S>(args: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    args.into_iter()
        .filter_map(|arg| {
            let arg = arg.into();
            let arg = arg.to_string_lossy();
            let payload = arg.strip_prefix(CLI_ENV_PREFIX)?;
            let (key, value) = payload.split_once('=')?;

            if !key.starts_with(ENV_NAME_PREFIX) || key.len() == ENV_NAME_PREFIX.len() {
                return None;
            }

            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_cli_env_overrides;

    #[test]
    fn parses_supported_kechimochi_overrides() {
        let overrides = parse_cli_env_overrides([
            "--kechimochi-env=KECHIMOCHI_DATA_DIR=C:\\temp\\kechimochi-e2e",
            "--kechimochi-env=KECHIMOCHI_GOOGLE_AUTH_ENDPOINT=http://127.0.0.1:4010/auth",
        ]);

        assert_eq!(
            overrides,
            vec![
                (
                    "KECHIMOCHI_DATA_DIR".to_string(),
                    "C:\\temp\\kechimochi-e2e".to_string(),
                ),
                (
                    "KECHIMOCHI_GOOGLE_AUTH_ENDPOINT".to_string(),
                    "http://127.0.0.1:4010/auth".to_string(),
                ),
            ]
        );
    }

    #[test]
    fn ignores_invalid_override_arguments() {
        let overrides = parse_cli_env_overrides([
            "--kechimochi-env=PATH=C:\\Windows",
            "--kechimochi-env=KECHIMOCHI_=missing-name",
            "--kechimochi-env=KECHIMOCHI_DATA_DIR",
            "--something-else=KECHIMOCHI_DATA_DIR=C:\\temp",
        ]);

        assert!(overrides.is_empty());
    }
}