return {
{
    "RRethy/vim-illuminate",
    event = { "BufReadPost", "BufNewFile" },
    opts = {
        delay = 0,
        large_file_cutoff = 2000,
        large_file_overrides = {
            providers = { "lsp" },
        },
    },
    config = function(_, opts)
    require("illuminate").configure(opts)

    -- highlight style
    vim.api.nvim_set_hl(0, "IlluminatedWordText", { bg = "#354034" })
    vim.api.nvim_set_hl(0, "IlluminatedWordRead", { bg = "#354034" })
    vim.api.nvim_set_hl(0, "IlluminatedWordWrite", { bg = "#354034" })
    
 -- clear the default LSP highlighting
        vim.api.nvim_set_hl(0, "LspReferenceText", { })
        vim.api.nvim_set_hl(0, "LspReferenceRead", { })
        vim.api.nvim_set_hl(0, "LspReferenceWrite", { })

    -- keymaps
    vim.keymap.set("n", "]]", function()
        require("illuminate").goto_next_reference(false)
    end, { desc = "Next Reference" })
    vim.keymap.set("n", "[[", function()
        require("illuminate").goto_prev_reference(false)
    end, { desc = "Prev Reference" })
end,
}
}
