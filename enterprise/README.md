---
description: "Enterprise account, model provisioning, Desktop integration, and deployment packages."
kind: "package-group"
---

# enterprise/ — Company accounts and Desktop integration

English | [中文](README.zh.md)

## Summary

Connect company accounts and approved model configuration to the shared DSH Desktop application. Deploy authentication and administration on the company server while employees keep conversations and project data on their computers. The enterprise bundle adds account UI, branding, and model defaults; the native adapter owns authentication and account switching around Host startup. Enterprise implementations, deployment files, artwork, and tests stay in this directory.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the package that owns the service or integration being changed.

| Package | Role |
|---|---|
| [`backend`](backend/README.md) | Server authentication, administration, model provisioning, and Docker deployment |
| [`protocol`](protocol/README.md) | Shared validation and identity types without server or Electron dependencies |
| [`account`](account/README.md) | Enterprise account settings, company branding, and assistant identity plugins |
| [`bundle`](bundle/README.md) | Enterprise profile layer over the standard DSH Web composition |
| [`desktop`](desktop/README.md) | Electron authentication and account lifecycle adapter, release configuration, artwork, and packaging helpers |

Enterprise Host and Client behavior uses plugins and bundles. The shared Desktop application calls the native adapter through narrow product operations; it does not duplicate the enterprise implementation.

-----

<a id="related-documentation"></a>
## Related documentation

- [Enterprise architecture and acceptance](../docs/ent-agent/enterprise_agent_harness_proposal.md) — deployment, data isolation, and release acceptance.
- [DSH architecture](../docs/architecture.md) — shared application launch and plugin composition.
- [Enterprise contributor instructions](AGENTS.md) — ownership and integration rules for this directory.

<a id="dev-note"></a>
## Dev Note

None.
