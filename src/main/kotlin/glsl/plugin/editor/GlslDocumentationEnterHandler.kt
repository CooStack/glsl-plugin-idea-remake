package glsl.plugin.editor

import com.intellij.codeInsight.editorActions.enter.EnterHandlerDelegate
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.actionSystem.EditorActionHandler
import com.intellij.openapi.util.Ref
import com.intellij.psi.PsiFile
import glsl.GlslTypes.MULTILINE_COMMENT
import glsl.plugin.language.GlslFile

class GlslDocumentationEnterHandler : EnterHandlerDelegate {
    override fun preprocessEnter(
        file: PsiFile,
        editor: Editor,
        caretOffsetRef: Ref<Int>,
        caretAdvance: Ref<Int>,
        dataContext: DataContext,
        originalHandler: EditorActionHandler?,
    ): EnterHandlerDelegate.Result {
        if (file !is GlslFile) return EnterHandlerDelegate.Result.Continue

        val document = editor.document
        val caretOffset = caretOffsetRef.get()
        val text = document.charsSequence
        val lineNumber = document.getLineNumber(caretOffset)
        val lineStart = document.getLineStartOffset(lineNumber)
        val lineEnd = document.getLineEndOffset(lineNumber)
        val lineBeforeCaret = text.subSequence(lineStart, caretOffset).toString()
        val indent = lineBeforeCaret.takeWhile { it == ' ' || it == '\t' }
        val commentElement = file.findElementAt((caretOffset - 1).coerceAtLeast(0))
        if (commentElement?.node?.elementType != MULTILINE_COMMENT) {
            return EnterHandlerDelegate.Result.Continue
        }

        val lineAfterCaret = text.subSequence(caretOffset, lineEnd).toString()
        if (lineBeforeCaret.trim() == "/**" && (lineAfterCaret.isBlank() || lineAfterCaret.trim() == "*/")) {
            val closingOffset = text.indexOf("*/", caretOffset)
            val nextOpeningOffset = text.indexOf("/**", caretOffset)
            val insertion = when {
                closingOffset == caretOffset -> "\n$indent * \n$indent "
                closingOffset >= 0 && (nextOpeningOffset < 0 || closingOffset < nextOpeningOffset) -> "\n$indent * "
                else -> "\n$indent * \n$indent */"
            }
            document.insertString(caretOffset, insertion)
            editor.caretModel.moveToOffset(caretOffset + indent.length + 4)
            return EnterHandlerDelegate.Result.Stop
        }

        val openingOffset = text.lastIndexOf("/**", caretOffset - 1)
        val closingOffset = text.lastIndexOf("*/", caretOffset - 1)
        if (openingOffset < 0 || openingOffset < closingOffset) {
            return EnterHandlerDelegate.Result.Continue
        }

        val openingLine = document.getLineNumber(openingOffset)
        val openingLineStart = document.getLineStartOffset(openingLine)
        val commentIndent = text.subSequence(openingLineStart, openingOffset).toString()
            .takeWhile { it == ' ' || it == '\t' }
        val insertion = "\n$commentIndent * "
        document.insertString(caretOffset, insertion)
        editor.caretModel.moveToOffset(caretOffset + insertion.length)
        return EnterHandlerDelegate.Result.Stop
    }
}
