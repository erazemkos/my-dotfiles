return {
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    cmd = "Telescope",
    keys = {
      { "<leader>ff", function()
        require('telescope.builtin').live_grep({
          cwd = vim.fn.systemlist("git rev-parse --show-toplevel")[1],
          additional_args = function()
              return {
                  "--glob=!_build/*",
              }
          end,
        })
      end, desc = "Search in Project" },
      { "<leader>fF", "<cmd>Telescope find_files<cr>", desc = "Find files" },
      { "<leader>fg", "<cmd>Telescope live_grep<cr>", desc = "Live grep" },
      { "<leader>fb", "<cmd>Telescope buffers<cr>", desc = "Buffers" },
      { "<leader>fh", "<cmd>Telescope help_tags<cr>", desc = "Help tags" },
    },
    config = function()
      local builtin = require('telescope.builtin')
      vim.keymap.set('n', 'gd', builtin.lsp_definitions, { desc = 'Go to definition' })
      vim.keymap.set('n', 'gr', builtin.lsp_references, { desc = 'Go to references' })
      vim.keymap.set('n', 'gi', builtin.lsp_implementations, { desc = 'Go to implementation' })
      vim.api.nvim_command('highlight TelescopePromptPrefix guifg=#b19c79')
      vim.api.nvim_command('highlight TelescopePromptTitle guibg=#b19c79')
      vim.api.nvim_command('highlight TelescopePreviewTitle guibg=#b19c79')

    end,
    opts = {
      defaults = {
        mappings = {
          i = {
            ["<C-j>"] = "move_selection_next",
            ["<C-k>"] = "move_selection_previous",
          },
        },
      },
    },
  },
}
