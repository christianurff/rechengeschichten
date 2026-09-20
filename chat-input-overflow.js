(function (global) {
    'use strict';

    function shouldCollapseChatTools(options) {
        const settings = options || {};
        const availableWidth = Math.max(0, Number(settings.availableWidth) || 0);
        const toolCount = Math.max(0, Number(settings.toolCount) || 0);
        if (!availableWidth || !toolCount) return false;

        const buttonSize = Math.max(0, Number(settings.buttonSize) || 48);
        const gap = Math.max(0, Number(settings.gap) || 8);
        const horizontalPadding = Math.max(0, Number(settings.horizontalPadding) || 30);
        const sendWidth = Math.max(0, Number(settings.sendWidth) || buttonSize);
        const minimumInputWidth = Math.max(0, Number(settings.minimumInputWidth) || 180);
        const previewWidth = Math.max(0, Number(settings.previewWidth) || 0);
        const fixedControlsWidth = Math.max(0, Number(settings.fixedControlsWidth) || 0);
        const fixedControlCount = Math.max(0, Number(settings.fixedControlCount) || 0);
        const toolsWidth = (toolCount * buttonSize) + (Math.max(0, toolCount - 1) * gap);
        const directItemCount = fixedControlCount + (previewWidth > 0 ? 4 : 3);
        const directGaps = Math.max(0, directItemCount - 1) * gap;
        const requiredWidth = horizontalPadding + fixedControlsWidth + toolsWidth + previewWidth
            + minimumInputWidth + sendWidth + directGaps;

        return requiredWidth > availableWidth;
    }

    const api = { shouldCollapseChatTools };
    global.ChatInputOverflow = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof window !== 'undefined' ? window : globalThis));
