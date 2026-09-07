# @yashumani/gridwright-contracts

Versioned handoff envelopes, capability descriptors and an untrusted-text scanner — the vocabulary every other package speaks across a trust boundary.

```bash
pnpm add @yashumani/gridwright-contracts
```

Identity comes from authenticated service context, never from the payload: an envelope carrying its own tenant, user, scope or role fields is refused as **malformed** rather than cleaned, because silently stripping a forged claim teaches a caller that sending one is harmless. Capability checks run in a fixed, tested order, and an advisor may deny but has no counterpart that grants.

- [Documentation](https://github.com/yashumani/gridwright/tree/main/docs)
- [Readiness report](https://github.com/yashumani/gridwright/blob/main/docs/project/READINESS.md) — what is proven and what is merely built
- [Contributing](https://github.com/yashumani/gridwright/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/yashumani/gridwright/blob/main/SECURITY.md)

MIT © [yashumani](https://github.com/yashumani)
