return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    event = { "BufReadPost", "BufNewFile" },
    opts = {
      highlight = { enable = true },
      indent = { enable = false },
      ensure_installed = {  
        "lua",
        "vim",
        "go",
        "c",
        "vimdoc",
        "query",
        "javascript",
        "html",
        "css",
        "json",
        "markdown",
        "python",
      },
    },
    config = function(_, opts)
      require("nvim-treesitter.configs").setup(opts)
    end,
  },
}
