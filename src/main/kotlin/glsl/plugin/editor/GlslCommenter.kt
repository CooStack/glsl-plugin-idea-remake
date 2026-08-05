package glsl.plugin.editor

import com.intellij.lang.CodeDocumentationAwareCommenter
import com.intellij.psi.PsiComment
import com.intellij.psi.tree.IElementType
import glsl.GlslTypes.LINE_COMMENT
import glsl.GlslTypes.MULTILINE_COMMENT

class GlslCommenter : CodeDocumentationAwareCommenter {
    /**
    *
    */
    override fun getLineCommentPrefix(): String? {
        return "//"
    }

    /**
    *
    */
    override fun getBlockCommentPrefix(): String? {
        return "/*"
    }

    /**
    *
    */
    override fun getBlockCommentSuffix(): String? {
        return "*/"
    }

    /**
    *
    */
    override fun getCommentedBlockCommentPrefix(): String? {
        return null
    }

    /**
    *
    */
    override fun getCommentedBlockCommentSuffix(): String? {
        return null
    }

    override fun getLineCommentTokenType(): IElementType {
        return LINE_COMMENT
    }

    override fun getBlockCommentTokenType(): IElementType {
        return MULTILINE_COMMENT
    }

    override fun getDocumentationCommentTokenType(): IElementType {
        return MULTILINE_COMMENT
    }

    override fun getDocumentationCommentPrefix(): String {
        return "/**"
    }

    override fun getDocumentationCommentLinePrefix(): String {
        return "*"
    }

    override fun getDocumentationCommentSuffix(): String {
        return "*/"
    }

    override fun isDocumentationComment(comment: PsiComment): Boolean {
        val offset = comment.textOffset
        val fileText = comment.containingFile.text
        val openingOffset = fileText.lastIndexOf("/**", offset)
        val closingOffset = fileText.lastIndexOf("*/", offset)
        return openingOffset >= 0 && openingOffset > closingOffset
    }
}
