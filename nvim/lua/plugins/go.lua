return {
  {
  "ray-x/go.nvim",
  dependencies = {  -- optional packages
    "ray-x/guihua.lua",
    "neovim/nvim-lspconfig",
    "nvim-treesitter/nvim-treesitter",
  },
  config = function()
      require("go").setup({
          icons = false,
          verbose_tests = true,
          floaterm = {   -- position
            posititon = 'bottom',
            height = 0.25,
        },
      })
      vim.keymap.set("n", "<leader>dn", "<cmd>GoDebug -n<CR>", {
        silent = true,
        noremap = true,
        desc = "Debug nearest Go test"
      })
      vim.keymap.set("n", "<leader>dr", "<cmd>GoDebug -R<CR>", {
        silent = true,
        noremap = true,
        desc = "Debug (Re)start"
      })
      vim.keymap.set("n", "<leader>ds", "<cmd>GoDebug -s<CR>", {
        silent = true,
        noremap = true,
        desc = "Debug stop"
      })

      vim.keymap.set("n", "<leader>ta", "<cmd>GoTestSum<CR>", {
        silent = true,
        noremap = true,
        desc = "Test All"
      })
      vim.keymap.set("n", "<leader>tf", "<cmd>GoTestFunc -v -F<CR>", {
        silent = true,
        noremap = true,
        desc = "Test current func"
      })
      vim.keymap.set("n", "<leader>tc", "<cmd>GoTestSubCase -v -F<CR>", {
        silent = true,
        noremap = true,
        desc = "Test current case"
      })
    end,
  event = {"CmdlineEnter"},
  ft = {"go", 'gomod'},
  build = ':lua require("go.install").update_all_sync()' -- if you need to install/update all binaries
}
}
