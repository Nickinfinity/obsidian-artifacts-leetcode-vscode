# LeetCode example artifacts

Runnable reference examples of the `type: leetcode` vault `.md` format —
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
└── function/                    # test.type: function
    ├── arrays/
    │   └── two-sum.md            # java · python · javascript · rust · typescript
    └── strings/
        ├── is-anagram.md         # java · python · javascript · rust · typescript
        └── leetcode-ab-check.md  # java · python · javascript
```

`class`, `stdin-stdout`, and `in-place` are reserved `test.type` values with
no registered environment yet (see the capability matrix in the format spec)
— no examples exist for them until an environment does.
