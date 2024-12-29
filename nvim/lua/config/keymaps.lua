local keymap = vim.keymap.set

-- Better window navigation
keymap("n", "<C-h>", "<C-w>h", { desc = "Navigate left window" })
keymap("n", "<C-j>", "<C-w>j", { desc = "Navigate down window" })
keymap("n", "<C-k>", "<C-w>k", { desc = "Navigate up window" })
keymap("n", "<C-l>", "<C-w>l", { desc = "Navigate right window" })

-- Clear highlights
keymap("n", "<leader>h", "<cmd>nohlsearch<CR>", { desc = "Clear highlights" })
