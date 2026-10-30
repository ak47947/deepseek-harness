---
description: "Validate enterprise account identities and model provisioning shared by Desktop and the enterprise service."
kind: "package-library"
---

# @deepseek-ai/dsh-enterprise-protocol

English | [中文](README.zh.md)

## Summary

Desktop and the enterprise service use this library to validate the account and model configuration they exchange. Import its schemas and branded identity types without loading the authentication server, database, or Electron. Parsing checks response fields; the caller still authenticates the response and enforces account expiry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the root entry from enterprise service or Desktop code. This library has no profile row or application launcher.

```ts
import { endpointSchema } from '@deepseek-ai/dsh-enterprise-protocol'

const endpoint = endpointSchema.parse('https://models.example.test/v1')
```

`endpointSchema` accepts HTTPS and loopback HTTP endpoints without embedded credentials, query parameters, or fragments. `enterpriseSessionSchema` validates the authenticated account response and its provisioning fields; invalid input rejects parsing. `EnterpriseRequestError` reports an HTTP status without retaining upstream response bodies or credentials.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) owns the Zod schemas, branded IDs, inferred response types, and status error. It depends on Zod at runtime and the stateless identity brand declarations at compile time. Authentication and persistence remain in the enterprise service; Desktop imports the same validators without depending on that service implementation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise service](../backend/README.md) — authentication, model provisioning, and deployment.
- [Brand types](../../packages/util/brand/README.md) — opaque identity declarations.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Parsing does not verify the response's issuer or grant account access. Callers own authenticated transport, authorization, and expiry handling.
- Provisioning requires explicit model capabilities and a default model present in the unique model list. The parser accepts no executable configuration.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
