package glsl.plugin.editor

import com.intellij.lang.documentation.DocumentationProvider
import com.intellij.lang.documentation.DocumentationMarkup
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.text.StringUtil
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.util.PsiTreeUtil.getParentOfType
import glsl.plugin.GlslBundle
import glsl.plugin.psi.GlslIdentifier
import glsl.plugin.utils.GlslBuiltinUtils.isBuiltinFunction
import glsl.plugin.utils.GlslUtils
import glsl.psi.interfaces.GlslExternalDeclaration
import glsl.psi.interfaces.GlslFunctionDeclarator
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.util.concurrent.ConcurrentHashMap

/**
 *
 */
class GlslDocumentationProvider : DocumentationProvider {
    private val documents = ConcurrentHashMap<String, Document>()

    /**
     *
     */
    override fun getCustomDocumentationElement(
        editor: Editor,
        file: PsiFile,
        contextElement: PsiElement?,
        targetOffset: Int
    ): PsiElement? {
        if (isBuiltinFunction(file.project, contextElement?.text)) {
            return contextElement
        }
        return resolveFunction(contextElement)
    }

    /**
     *
     */
    override fun generateDoc(element: PsiElement?, originalElement: PsiElement?): String? {
        val elementText = element?.text
        if (element != null && isBuiltinFunction(element.project, elementText)) {
            val resourcePath = GlslBundle.message("documentation.builtin.resource")
            return getDocumentation(elementText!!, resourcePath)
        }
        val function = resolveFunction(element) ?: resolveFunction(originalElement) ?: return null
        val commentText = findDocumentationComment(function) ?: return null
        return buildUserDocumentation(function, commentText)
    }

    internal fun getDocumentation(functionName: String, resourcePath: String): String? {
        val document = documents.computeIfAbsent(resourcePath) {
            val fileText = GlslUtils.getResourceFileAsString(it) ?: return@computeIfAbsent Document("")
            Jsoup.parse(fileText)
        }
        return document.getElementById(functionName)?.toString()
    }

    private fun resolveFunction(element: PsiElement?): GlslFunctionDeclarator? {
        var current = element
        while (current != null && current !is PsiFile) {
            if (current is GlslFunctionDeclarator) return current
            if (current is GlslIdentifier) {
                val function = current.resolveReference() as? GlslFunctionDeclarator
                if (function != null) return function
            }
            current = current.parent
        }
        return null
    }

    private fun findDocumentationComment(function: GlslFunctionDeclarator): String? {
        val declaration = getParentOfType(function, GlslExternalDeclaration::class.java) ?: return null
        val sourceBeforeDeclaration = function.containingFile.text
            .substring(0, declaration.textRange.startOffset)
            .trimEnd()
        if (!sourceBeforeDeclaration.endsWith("*/")) return null

        val commentEnd = sourceBeforeDeclaration.length
        val commentStart = sourceBeforeDeclaration.lastIndexOf("/**")
        if (commentStart < 0 || sourceBeforeDeclaration.indexOf("*/", commentStart) != commentEnd - 2) return null
        return sourceBeforeDeclaration.substring(commentStart, commentEnd)
    }

    private fun buildUserDocumentation(function: GlslFunctionDeclarator, rawComment: String): String {
        val qualifier = function.typeQualifier?.text?.let { "$it " }.orEmpty()
        val parameters = function.funcHeaderWithParams?.text.orEmpty()
        val definition = StringUtil.escapeXmlEntities(
            "$qualifier${function.typeSpecifier.text} ${function.variableIdentifier.text}($parameters)",
        )
        val content = rawComment
            .removePrefix("/**")
            .removeSuffix("*/")
            .lines()
            .joinToString("\n") { line -> line.trim().removePrefix("*").trimStart() }
            .trim()
        val escapedContent = StringUtil.escapeXmlEntities(content).replace("\n", "<br>")
        return DocumentationMarkup.DEFINITION_START + definition + DocumentationMarkup.DEFINITION_END +
            DocumentationMarkup.CONTENT_START + escapedContent + DocumentationMarkup.CONTENT_END
    }
}
