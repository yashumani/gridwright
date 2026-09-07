# @gridwright/runtime

Scoped sessions, cache invalidation and approvals bound to an actor, an action and an input digest.

```bash
pnpm add @gridwright/runtime
```

Authorization is rechecked on every read, not only on write, and the cache key carries the whole boundary — tenant, user, sorted scopes and all four versions — so no answer crosses a tenant. Revocation stops entries being served before they expire, and deletion is observable. An approval is single-use and read-only mode cannot publish; refusing does not spend the approval it refused.

- [Documentation](https://github.com/yashumani/gridwright/tree/main/docs)
- [Readiness report](https://github.com/yashumani/gridwright/blob/main/docs/project/READINESS.md) — what is proven and what is merely built
- [Contributing](https://github.com/yashumani/gridwright/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/yashumani/gridwright/blob/main/SECURITY.md)

MIT © [yashumani](https://github.com/yashumani)
