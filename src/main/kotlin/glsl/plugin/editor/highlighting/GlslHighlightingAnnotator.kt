package glsl.plugin.editor.highlighting

import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.Annotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.psi.PsiElement
import glsl.plugin.inspections.GlslErrorCode
import glsl.plugin.psi.GlslIdentifier
import glsl.plugin.psi.GlslType
import glsl.plugin.psi.GlslVariable
import glsl.plugin.psi.named.GlslNamedElement
import glsl.plugin.psi.named.types.builtins.GlslBuiltinType
import glsl.plugin.utils.GlslBuiltinUtils.isBuiltinConstant
import glsl.plugin.utils.GlslBuiltinUtils.isBuiltinFunction
import glsl.plugin.utils.GlslBuiltinUtils.isBuiltinShaderVariable
import glsl.psi.interfaces.GlslLayoutQualifierId
import glsl.psi.interfaces.GlslPpStatement
import glsl.psi.interfaces.GlslPrimaryExpr


/**
 *
 */
class GlslHighlightingAnnotator : Annotator {

    /**
     *
     */
    override fun annotate(element: PsiElement, holder: AnnotationHolder) {
        if (element !is GlslIdentifier || element is GlslBuiltinType) return
        val extension = holder.currentAnnotationSession.file.virtualFile.extension
        val elementName = element.getName()
        if (isBuiltinFunction(element.project, elementName) ||
            isBuiltinShaderVariable(element.project, elementName, extension)
        ) {
            createAnnotation(holder, GlslTextAttributes.BUILTIN_NAME_TEXT_ATTR)
        } else if (isBuiltinConstant(element.project, elementName)) {
            createAnnotation(holder, GlslTextAttributes.BUILTIN_GLOBAL_CONSTANTS)
        } else {
            val reference = element.resolveReference()
            if (reference != null) {
                setReferenceHighlighting(reference, holder)
            } else {
                setDeclarationOrErrorHighlighting(element, holder)
            }
        }

    }

    /**
     *
     */
    private fun setReferenceHighlighting(element: GlslNamedElement, holder: AnnotationHolder) {
        val textAttr = element.getHighlightTextAttr()
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .textAttributes(textAttr)
            .create()
    }

    /**
     *
     */
    private fun setDeclarationOrErrorHighlighting(element: GlslIdentifier, holder: AnnotationHolder) {
        if (element.parent is GlslLayoutQualifierId) {
            createAnnotation(holder, GlslTextAttributes.VARIABLE_TEXT_ATTR)
            return
        }
        val declaration = element.getDeclaration()
        if (declaration != null) {
            createAnnotation(holder, declaration.getHighlightTextAttr())
            return
        }

        when (element) {
            is GlslType -> {
                if (element.isEmpty()) return
                createErrorAnnotation(
                    holder,
                    GlslErrorCode.UNRESOLVED_TYPE.message(element.getName()),
                )
            }
            is GlslVariable -> {
                if (!isExpressionReference(element)) return
                createErrorAnnotation(
                    holder,
                    GlslErrorCode.UNRESOLVED_SYMBOL.message(element.getName()),
                )
            }
        }
    }

    private fun isExpressionReference(element: GlslVariable): Boolean {
        if (element.isEmpty()) return false
        if (element.parent !is GlslPrimaryExpr) return false

        var parent = element.parent
        while (parent != null) {
            if (parent is GlslPpStatement) return false
            parent = parent.parent
        }
        return true
    }

    /**
     *
     */
    private fun createAnnotation(holder: AnnotationHolder, textAttr: TextAttributesKey?) {
        if (textAttr == null) return
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .textAttributes(textAttr)
            .create()
    }

    private fun createErrorAnnotation(holder: AnnotationHolder, message: String) {
        holder.newAnnotation(HighlightSeverity.ERROR, message).create()
    }
}
