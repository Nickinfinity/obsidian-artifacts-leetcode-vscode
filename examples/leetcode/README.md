# LeetCode example artifacts

Reference examples of the `type: leetcode` vault `.md` format —
see [`ARTIFACT_LEETCODE_FILE_FORMAT.md`](../../ARTIFACT_LEETCODE_FILE_FORMAT.md)
for the authoritative on-disk spec. Copy any file under this tree into your
vault's `LeetCode/` folder to try it. Every reference solution shipped here
was run to green against its full test suite (public + hidden) with the real
per-language toolchain before being committed — a wrong reference solution
wastes the time of whoever opens it next.

`test/examples.test.ts` walks this tree recursively and parses every `.md`
file it finds, so a new example dropped anywhere below `examples/leetcode/`
is guarded automatically — no registration step.

## Taxonomy

Organised **type-first, then topic**: the top-level folder is a `test.type`
value, the folder beneath it is a problem topic. A language-named folder only
appears where an example is genuinely single-language; the normal case is a
multi-language file with one `## <Language>` heading per Setup/Solution
language.

```
examples/leetcode/
├── function/                    # test.type: function — RUNNABLE
│   ├── arrays/
│   │   └── two-sum.md            # java · python · javascript · rust · typescript
│   └── strings/
│       ├── is-anagram.md         # java · python · javascript · rust · typescript
│       └── leetcode-ab-check.md  # java · python · javascript
├── project/                     # test.type: project — CONTRACT ONLY
│   └── typescript/
│       └── nextjs-object-list.md # multi-file, one runtime; function + build checks
└── service/                     # test.type: service — CONTRACT ONLY
    ├── multi/
    │   └── fastapi-react.md      # python + typescript, two booted services
    └── typescript/
        └── node-react-fullstack.md  # express + react, single-language
```

`class`, `stdin-stdout`, and `in-place` are reserved `test.type` values with
no registered environment yet (see the capability matrix in the format spec)
— no examples exist for them until an environment does.

## ⚠️ `project/` and `service/` do not run

Those two types are **reserved** as well: the artifacts parse, list in the
picker, and explain themselves in the panel — they grade nothing, boot no
server, and install no library. They are spike deliverables for §9 of the
format spec (multi-file / running-server contract), written against the real
parser precisely to find what the contract is missing; the findings live in
`docs/plans/rust-multilang/spike-findings.md` (branch-local). Their `libs:`,
`## Files`, `checks:`, and `services:` blocks are ignored by today's parser.

The `function/` examples are the runnable set: every reference solution there
was executed to green against public **and** hidden cases with the real
toolchain before being committed.
