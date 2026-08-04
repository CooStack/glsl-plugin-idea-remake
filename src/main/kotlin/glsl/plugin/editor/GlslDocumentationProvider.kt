package glsl.plugin.editor

import com.intellij.lang.documentation.DocumentationProvider
import com.intellij.openapi.editor.Editor
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import glsl.plugin.GlslBundle
import glsl.plugin.utils.GlslBuiltinUtils.isBuiltinFunction
import glsl.plugin.utils.GlslUtils
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
        return null
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
        return null
    }

    internal fun getDocumentation(functionName: String, resourcePath: String): String? {
        val document = documents.computeIfAbsent(resourcePath) {
            val fileText = GlslUtils.getResourceFileAsString(it) ?: return@computeIfAbsent Document("")
            Jsoup.parse(fileText)
        }
        return document.getElementById(functionName)?.toString()
    }
}
