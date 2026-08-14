# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.2] - 2026-08-14

### Fixed

- Rename Admin API to API

## [0.6.1] - 2026-08-14

### Fixed

- Login — вход в систему, а не в админ-панель

## [0.6.0] - 2026-08-14

### Added

- Add user role (admin/moderator/user) to OpenAPI spec

## [0.5.0] - 2026-08-13

### Added

- Add Users CRUD + change-password endpoints (v0.5.0)

### Fixed

- Remove container name race in docs systemd unit

## [0.4.2] - 2026-08-13

## [0.4.1] - 2026-08-13

### Fixed

- Align OpenAPI version to 3.0.3 and unify docker image name

## [0.4.0] - 2026-08-12

### Added

- Add optional `search` query param to `GET /sermons`

## [0.3.0] - 2026-08-11

### Added

- Add changelog generation and Forgejo releases

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

[0.6.2]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.6.2
[0.6.1]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.6.1
[0.6.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.6.0
[0.5.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.5.0
[0.4.2]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.4.2
[0.4.1]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.4.1
[0.4.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.4.0
[0.3.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.3.0
[0.2.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.2.0
[0.1.1]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.1.1
[0.1.0]: https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs/src/tag/v0.1.0
