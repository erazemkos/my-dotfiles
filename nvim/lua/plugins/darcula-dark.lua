return {
    {
        "xiantang/darcula-dark.nvim",
        config = function()
            local import_green = "#aec07f"  -- Adjust this color to match GoLand
            local constant_purple = "#9977aa"
            local function_bronze = "#b19c79"
            local type_blue = "#4cace5"
            local func_yellow = "#ffc66d"
            local burnt_orange = "#CC7832"

     vim.api.nvim_create_augroup("GoReceiverHighlight", { clear = true })
      vim.api.nvim_create_autocmd({ "BufEnter", "BufWinEnter" }, {
        group = "GoReceiverHighlight",
        pattern = "*.go",
        callback = function(ev)
          local query = vim.treesitter.query.parse("go", [[
            (method_declaration
              receiver: (parameter_list
                (parameter_declaration
                  (identifier) @receiver)))
          ]])
          
          local bufnr = ev.buf
          local parser = vim.treesitter.get_parser(bufnr, "go")
          if not parser then
            print("No parser available")
            return
          end
          
          local tree = parser:parse()[1]
          local root = tree:root()

          for id, node in query:iter_captures(root, bufnr, 0, -1) do
            local start_row, start_col, end_row, end_col = node:range()
            print(string.format("Found receiver at %d:%d to %d:%d", start_row, start_col, end_row, end_col))
            vim.api.nvim_buf_add_highlight(bufnr, -1, "GoReceiverParameter", start_row, start_col, end_col)
          end
        end,
      })
            
            require("darcula").setup({
                override = function(c)
                    return {
                    }
                end,
                opt = {
                    integrations = {
                        telescope = true,
                        lualine = true,
                        lsp_semantics_token = true,
                        nvim_cmp = true,
                        dap_nvim = true,
                    },
                },
            })

            local hi = vim.api.nvim_set_hl
            vim.cmd.colorscheme("darcula-dark")
            
      hi(0, "@lsp.typemod.method.definition.go", { fg = func_yellow })

      hi(0, "@lsp.type.method.go", { fg = function_bronze})
      hi(0, "@lsp.type.function.go", { fg = function_bronze })
      --hi(0, "@variable.parameter.go@lsp.typemod.variable.definition.go", { fg = type_blue })
      hi(0, "TSTypeBuiltin", { fg = burnt_orange})
      hi(0, "GoReceiverParameter", { fg = type_blue })
        end,
    },
}
