---
type: leetcode
title: AB Check
difficulty: easy
function: ABCheck
algorithm: string-search
status: attempted
params:
  - name: str
    type: string
returns: string
test:
  type: function
  timeoutMs: 5000
tags: [leetcode, strings, easy]
---

Have the function ABCheck(str) take the str parameter being passed and return
the string "true" if the characters a and b are separated by exactly 3 places
anywhere in the string at least once (ie. "lane borrowed" would result in true
because there is exactly three characters between a and b). Otherwise return
the string "false".

## Examples

```example
input: "after badly"
output: "false"
```

```example
input: "Laura sobs"
output: "true"
```

## Tests

```json
[
    { "input": { "str": "after badly" }, "expected": "false" },
    { "input": { "str": "Laura sobs" }, "expected": "true" },
    { "input": { "str": "a]]]b" }, "expected": "true" },
    { "input": { "str": "abc" }, "expected": "false" },
    { "input": { "str": "a___b___a___b" }, "expected": "true" },
    { "input": { "str": "" }, "expected": "false" }
]
```

# Setup

## Java

<!--
  Write ONLY the method — no `class`, no `main`.
  `import` lines may sit above it; the runner compiles this as its own unit
  (Solution.java) and calls ABCheck(...) from a generated Runner.
-->
```java
public static String ABCheck(String str) {
    // your code here
    return "false";
}
```

## Python

<!-- Top-level `def ABCheck` — not nested in a class; the runner imports this file. -->
```python
def ABCheck(s):
    # your code here
    return "false"
```

## JavaScript

<!-- Top-level function named ABCheck; the runner evaluates this file in a vm sandbox. -->
```javascript
function ABCheck(str) {
    // your code here
    return 'false';
}
```

# Solutions

## Java

### Brute Force
<!-- meta: { "solved_at": "2025-05-12T14:30:00", "duration": "12m34s" } -->
```java
public static String ABCheck(String str) {
    for (int i = 0; i < str.length() - 4; i++) {
        if (str.charAt(i) == 'a' && str.charAt(i + 4) == 'b') {
            return "true";
        }
        if (str.charAt(i) == 'b' && str.charAt(i + 4) == 'a') {
            return "true";
        }
    }
    return "false";
}
```

### Regex
<!-- meta: { "solved_at": "2025-05-12T15:10:00", "duration": "3m12s" } -->
```java
public static String ABCheck(String str) {
    return str.matches(".*[ab].{3}[ab].*") ? "true" : "false";
}
```

## Python

```python
def ABCheck(s):
    for i in range(len(s) - 4):
        pair = s[i] + s[i + 4]
        if pair in ('ab', 'ba'):
            return "true"
    return "false"
```

## JavaScript

```javascript
function ABCheck(str) {
    for (let i = 0; i < str.length - 4; i++) {
        const pair = str[i] + str[i + 4];
        if (pair === 'ab' || pair === 'ba') {
            return 'true';
        }
    }
    return 'false';
}
```

# Attempts

## java
<!-- attempt: {"at":"2026-07-16T05:03:05.031Z","duration":"0m26s","passed":false,"bigO":"O(1)","confidence":"high"} -->
```java
public static String ABCheck(String str) {
    // your code here
    return "false";
}
```
