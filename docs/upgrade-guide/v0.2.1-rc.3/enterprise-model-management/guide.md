---
kind: upgrade-guide
description: "Enterprise sessions without assigned models now return null provisioning and allow personal Desktop configuration."
---

# Enterprise models and unassigned accounts

English | [中文](guide.zh.md)

## Change

`GET /v1/session` returns HTTP 200 with `provisioning: null` for an authenticated employee without an available personal assignment or default, instead of HTTP 409. Desktop starts and allows personal model configuration. Non-null provisioning retains its existing fields.

Model management supports publication and a single default selection. Unpublishing the default clears it. Unassigned employees receive only the default model from an existing multi-model configuration. Unpublishing a personally assigned model retains the selection but stops distributing it until publication resumes.

## Migration

1. Update the enterprise backend and Desktop together. Custom consumers of `EnterpriseSession` must handle null provisioning before reading provider fields; a missing field remains invalid.
2. Start the backend normally. Additive migrations retain encrypted configurations and assignments, with existing records published. No manual database edit is required.
3. In **Model management**, choose a published default or leave it unset. For an existing multi-model configuration, use **Edit model → Default model** to select its default. Manage personal assignments under **Users → Assign model**.
4. Confirm that a new unassigned employee receives only the selected default. Clear the default and confirm the employee can sign in and add a personal provider under **Settings → Models**.
