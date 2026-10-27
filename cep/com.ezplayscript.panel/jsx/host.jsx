/*
 * ExtendScript host: trigger Premiere's built-in Export Frame command.
 * PR 2023's QE DOM exportFramePNG() does not write files — use native command instead.
 * Panel watches .capture folder for the saved PNG, OCRs it, then deletes it.
 */

function triggerExportFrame() {
    try {
        // PR Export Frame command IDs (varies by version & locale).
        // 2157 = Export Frame (most PR versions)
        // 2918 = alternate ID
        var ids = [2157, 2918, 10137, 10313, 18900];
        for (var i = 0; i < ids.length; i++) {
            try { app.executeCommand(ids[i]); return 'OK:' + ids[i]; }
            catch (e) {}
        }
        return 'ERR:no Export Frame command ID matched';
    } catch (e) {
        return 'ERR:' + (e && e.toString ? e.toString() : String(e));
    }
}

function getSequenceInfo() {
    try {
        var s = app.project.activeSequence;
        if (!s) return 'ERR:No active sequence';
        return 'OK:' + s.name;
    } catch (e) { return 'ERR:' + e.toString(); }
}
