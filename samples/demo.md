# MD Viewer 冒烟测试

这是一个 **GitHub 风格** 的测试文档，覆盖常用 GFM 语法。

## 文本样式

**粗体**、*斜体*、~~删除线~~、`行内代码`、[外部链接](https://github.com)。

## 列表与任务

- 普通列表项一
- 普通列表项二

- [x] 已完成的任务
- [ ] 未完成的任务

## 表格

| 特性 | 支持情况 | 备注 |
| ---- | -------- | ---- |
| GFM 表格 | ✅ | markdown-it |
| 任务列表 | ✅ | 插件渲染 |
| 代码高亮 | ✅ | highlight.js |

## 代码块

```javascript
function greet(name) {
  console.log(`Hello, ${name}!`)
}
greet('MD Viewer')
```

```python
def fib(n: int):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

## 引用

> 这是一段引用文字。
> 渲染样式应当与 GitHub 一致。

---

测试完毕。
