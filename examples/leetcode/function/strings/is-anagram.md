---
type: leetcode
title: Valid Anagram
difficulty: easy
function: isAnagram
functions:
  rust: is_anagram
algorithm: hash-map
params:
  - name: s
    type: string
  - name: t
    type: string
returns: bool
test:
  type: function
  timeoutMs: 5000
tags: [leetcode, strings, hash-map]
---

Given two strings `s` and `t`, return `true` if `t` is an anagram of `s` — the
same characters, the same number of times, in any order — and `false`
otherwise.

## Examples

```example
input: s = "anagram", t = "nagaram"
output: true
```

```example
input: s = "rat", t = "car"
output: false
```

## Tests

```json
[
  { "input": { "s": "anagram", "t": "nagaram" }, "expected": true },
  { "input": { "s": "rat", "t": "car" }, "expected": false }
]
```

## Final Tests

```json
[
  { "input": { "s": "", "t": "" }, "expected": true },
  { "input": { "s": "a", "t": "ab" }, "expected": false }
]
```

# Setup

## Java

```java
public static boolean isAnagram(String s, String t) {
    // your code here
    return false;
}
```

## Python

```python
def isAnagram(s, t):
    # your code here
    return False
```

## JavaScript

```javascript
function isAnagram(s, t) {
  // your code here
  return false;
}
```

## Rust

```rust
fn is_anagram(s: String, t: String) -> bool {
    // your code here
    false
}
```

## TS

```typescript
function isAnagram(s: string, t: string): boolean {
  // your code here
  return false;
}
```

# Solutions

## Java

### Character Count Map
```java
import java.util.HashMap;
import java.util.Map;

public static boolean isAnagram(String s, String t) {
    if (s.length() != t.length()) {
        return false;
    }
    Map<Character, Integer> counts = new HashMap<>();
    for (char c : s.toCharArray()) {
        counts.merge(c, 1, Integer::sum);
    }
    for (char c : t.toCharArray()) {
        counts.merge(c, -1, Integer::sum);
    }
    for (int v : counts.values()) {
        if (v != 0) {
            return false;
        }
    }
    return true;
}
```

## Python

### Character Count Map
```python
def isAnagram(s, t):
    if len(s) != len(t):
        return False
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    for ch in t:
        counts[ch] = counts.get(ch, 0) - 1
    return all(v == 0 for v in counts.values())
```

## JavaScript

### Character Count Map
```javascript
function isAnagram(s, t) {
  if (s.length !== t.length) {
    return false;
  }
  const counts = new Map();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  for (const ch of t) {
    counts.set(ch, (counts.get(ch) || 0) - 1);
  }
  for (const v of counts.values()) {
    if (v !== 0) {
      return false;
    }
  }
  return true;
}
```

## Rust

### Character Count Map
```rust
use std::collections::HashMap;

fn is_anagram(s: String, t: String) -> bool {
    if s.len() != t.len() {
        return false;
    }
    let mut counts: HashMap<char, i32> = HashMap::new();
    for ch in s.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    for ch in t.chars() {
        *counts.entry(ch).or_insert(0) -= 1;
    }
    counts.values().all(|&v| v == 0)
}
```

## TS

### Character Count Map
```typescript
function isAnagram(s: string, t: string): boolean {
  if (s.length !== t.length) {
    return false;
  }
  const counts: Record<string, number> = {};
  for (const ch of s) {
    counts[ch] = (counts[ch] || 0) + 1;
  }
  for (const ch of t) {
    counts[ch] = (counts[ch] || 0) - 1;
  }
  return Object.values(counts).every(v => v === 0);
}
```
