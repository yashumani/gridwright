# @gridwright/bridge

The metadata bridge: an Excel skeleton, SQL configuration and explicit bindings compile to a validated report definition and fill from a prepared view.

```bash
pnpm add @gridwright/bridge
```

Configured headings, order, hierarchy and empty rows survive whatever the query returns — a queue the view has no data for still appears, because a row vanishing is a different statement from a row reading zero. An unsupported rule, a dependency cycle, an unknown reference or a division by zero is refused by name rather than approximated, and undefined is never silently zero.

- [Documentation](https://github.com/yashumani/gridwright/tree/main/docs)
- [Readiness report](https://github.com/yashumani/gridwright/blob/main/docs/project/READINESS.md) — what is proven and what is merely built
- [Contributing](https://github.com/yashumani/gridwright/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/yashumani/gridwright/blob/main/SECURITY.md)

MIT © [yashumani](https://github.com/yashumani)
