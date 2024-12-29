local opt = vim.opt

-- Basic settings
opt.encoding = "utf-8"
opt.fileencoding = "utf-8"
opt.number = true
opt.relativenumber = true
opt.mouse = "a"
opt.clipboard = "unnamedplus"
opt.expandtab = true
opt.tabstop = 4       -- Number of spaces tabs count for
opt.shiftwidth = 4    -- Size of an indent
opt.expandtab = true  -- Use spaces instead of tabs
opt.softtabstop = 4   -- Number of spaces that a <Tab> counts for while performing editing operations
opt.smartindent = true
opt.termguicolors = true
opt.ignorecase = true
opt.smartcase = true
opt.updatetime = 100
opt.timeoutlen = 500
opt.completeopt = { "menuone", "noselect" }
vim.opt.scrolloff = 9  -- Keep 9 lines above/below cursor when scrolling

-- Highlight yanked text
vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function()
    vim.highlight.on_yank({
      higroup = 'IncSearch',
      timeout = 150,
    })
  end,
})

