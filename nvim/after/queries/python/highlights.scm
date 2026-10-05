; extends
; Bring captures in line with VS Code's Python TextMate scopes; colors are set in the
; vscode.nvim group_overrides in init.lua. Later patterns win, so these override the base.

; `self`/`cls` in a parameter list are parameters
(parameters
  (identifier) @variable.parameter)

; `__init__`/`__new__` are defined like any other method
((function_definition
  name: (identifier) @function.method)
  (#any-of? @function.method "__init__" "__new__"))

; Class names are colored where defined and where inherited from, not where used
(class_definition
  name: (identifier) @type.definition)

(class_definition
  superclasses: (argument_list
    (identifier) @type.definition))

; Control flow, not operators
(for_statement
  "in" @keyword.repeat)

(for_in_clause
  "in" @keyword.repeat)

"del" @keyword

; Return annotation arrow is punctuation, not an operator
"->" @punctuation.delimiter

; Declarations, like `def`
(function_definition
  "async" @keyword.function)

[
  "global"
  "nonlocal"
] @keyword.modifier

; String prefixes (f, r, b, rb, ...) without the opening quote
((string_start) @string.prefix
  (#lua-match? @string.prefix "^%a+[\"']$")
  (#offset! @string.prefix 0 0 0 -1))

((string_start) @string.prefix
  (#lua-match? @string.prefix "^%a+[\"'][\"'][\"']$")
  (#offset! @string.prefix 0 0 0 -3))
