# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-11

### Added

- Auto-provision Traefik on fresh VPS (static config, ACME, systemd service)

### Changed

- Transfer source code via tar+ssh instead of git clone on VPS
- Remove DOCS_REPO variable — runner sends its checkout directly

## [0.1.1] - 2026-08-11

### Added

- Auto-provision slovo user, buildx builder, and Docker networks on fresh VPS
- Auto-install Docker if missing

### Fixed

- Prevent Traefik restarts from stopping the docs service (Requires → Wants)

## [0.1.0] - 2026-08-11

### Added

- Forgejo Actions CI/CD pipeline replacing the Ansible playbook deployment
- CI workflow with OpenAPI YAML validation on push/PR to main
- Release workflow with tag-triggered VPS deployment via SSH
- VPS deployment script (systemd service, Traefik labels, Docker buildx)
- Version bump script for package.json and openAPI.yaml

[0.2.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.2.0
[0.1.1]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.1.1
[0.1.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.1.0
