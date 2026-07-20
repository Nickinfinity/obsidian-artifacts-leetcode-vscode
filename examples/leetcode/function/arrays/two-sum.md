---
type: leetcode
title: Two Sum
difficulty: easy
function: twoSum
functions:
  rust: two_sum
algorithm: hash-map
params:
  - name: nums
    type: int[]
  - name: target
    type: int
returns: int[]
test:
  type: function
  timeoutMs: 5000
tags: [leetcode, arrays, hash-map]
---

Given an array of integers `nums` and an integer `target`, return the indices
of the two numbers that add up to `target`. Each input has exactly one
solution, and the same element may not be used twice. Return the indices in
the order they are found while scanning left to right.

## Examples

```example
input: nums = [2,7,11,15], target = 9
output: [0,1]
```

```example
input: nums = [3,2,4], target = 6
output: [1,2]
```

## Tests

```json
[
  { "input": { "nums": [2, 7, 11, 15], "target": 9 }, "expected": [0, 1] },
  { "input": { "nums": [3, 2, 4], "target": 6 }, "expected": [1, 2] }
]
```

## Final Tests

```json
[
  { "input": { "nums": [3, 3], "target": 6 }, "expected": [0, 1] },
  { "input": { "nums": [-1, -2, -3, -4, -5], "target": -8 }, "expected": [2, 4] }
]
```

# Setup

## Java

```java
public static int[] twoSum(int[] nums, int target) {
    // your code here
    return new int[]{};
}
```

## Python

```python
def twoSum(nums, target):
    # your code here
    return []
```

## JavaScript

```javascript
function twoSum(nums, target) {
  // your code here
  return [];
}
```

## Rust

```rust
fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {
    // your code here
    vec![]
}
```

## TS

```typescript
function twoSum(nums: number[], target: number): number[] {
  // your code here
  return [];
}
```

# Solutions

## Java

### Hash Map
```java
import java.util.HashMap;
import java.util.Map;

public static int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (seen.containsKey(complement)) {
            return new int[]{seen.get(complement), i};
        }
        seen.put(nums[i], i);
    }
    return new int[]{};
}
```

## Python

### Hash Map
```python
def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []
```

## JavaScript

### Hash Map
```javascript
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) {
      return [seen.get(complement), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}
```

## Rust

### Hash Map
```rust
use std::collections::HashMap;

fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {
    let mut seen: HashMap<i32, i32> = HashMap::new();
    for (i, &num) in nums.iter().enumerate() {
        let complement = target - num;
        if let Some(&j) = seen.get(&complement) {
            return vec![j, i as i32];
        }
        seen.insert(num, i as i32);
    }
    vec![]
}
```

## TS

### Hash Map
```typescript
function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) {
      return [seen.get(complement) as number, i];
    }
    seen.set(nums[i], i);
  }
  return [];
}
```
