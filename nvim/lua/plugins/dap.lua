return {
  {
    "nvim-neotest/nvim-nio",
    event = "VeryLazy",
  },
  {
    "mfussenegger/nvim-dap",
    lazy = true,
    dependencies = {
      {
        "rcarriga/nvim-dap-ui",
        config = function()
          require("dapui").setup({
            icons = { expanded = "▾", collapsed = "▸", current_frame = "▸" },
            mappings = {
              expand = { "<CR>", "<2-LeftMouse>" },
              open = "o",
              remove = "d",
              edit = "e",
              repl = "r",
              toggle = "t",
            },
            expand_lines = vim.fn.has("nvim-0.7"),
            layouts = {
              {
                elements = {
                  { id = "scopes", size = 0.25 },
                  "breakpoints",
                  "stacks",
                  "watches",
                },
                size = 40,
                position = "left",
              },
              {
                elements = {
                  "repl",
                  "console",
                },
                size = 0.25,
                position = "bottom",
              },
            },
            floating = {
              max_height = nil,
              max_width = nil,
              border = "single",
              mappings = {
                close = { "q", "<Esc>" },
              },
            },
          })
        end,
      },
      {
        "leoluz/nvim-dap-go",
        config = function()
          require("dap-go").setup()
        end,
      },
    },
    ft = { "go" },
    keys = {
      { "<F9>", function() require("dap").continue() end, desc = "Debug: Start/Continue" },
      { "<F8>", function() require("dap").step_over() end, desc = "Debug: Step Over" },
      { "<F7>", function() require("dap").step_into() end, desc = "Debug: Step Into" },
      { "<F20>", function() require("dap").step_out() end, desc = "Debug: Step Out" },
      { "<Leader>b", function() require("dap").toggle_breakpoint() end, desc = "Debug: Toggle Breakpoint" },
      { "<Leader>B", function() require("dap").set_breakpoint() end, desc = "Debug: Set Breakpoint" },
      { "<Leader>lp", function() require("dap").set_breakpoint(nil, nil, vim.fn.input('Log point message: ')) end, desc = "Debug: Log Point" },
      { "<Leader>dr", function() require("dap").repl.open() end, desc = "Debug: Open REPL" },
      { "<Leader>dl", function() require("dap").run_last() end, desc = "Debug: Run Last" },
      { "<Leader>dt", function() require("dapui").toggle() end, desc = "Debug: Toggle UI" },
    },
    config = function()
      local dap = require("dap")
      local dapui = require("dapui")

      -- Auto open/close DAP UI
      dap.listeners.after.event_initialized["dapui_config"] = function()
        dapui.open()
      end
      dap.listeners.before.event_terminated["dapui_config"] = function()
        dapui.close()
      end
      dap.listeners.before.event_exited["dapui_config"] = function()
        dapui.close()
      end

      vim.api.nvim_set_hl(0, 'DapBreakpoint', { fg = '#db4b4b', bold = true })  -- Medium red
      vim.api.nvim_set_hl(0, 'DapStoppedSign', { fg = '#98c379', bold = true })  -- Softer green
      -- Add some signs for breakpoints etc
      vim.fn.sign_define('DapBreakpoint', { text = '⬤', texthl = 'DapBreakpoint', linehl = '', numhl = '' })
      vim.fn.sign_define('DapStopped', { text = '▶', texthl = 'DapStoppedSign', linehl = '', numhl = '' })
    end,
  }
}
