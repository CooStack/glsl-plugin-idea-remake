package glsl.plugin.inspections

import com.intellij.codeInspection.ProblemHighlightType.GENERIC_ERROR
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.psi.PsiElementVisitor
import glsl.plugin.psi.GlslVariable
import glsl.plugin.psi.named.GlslNamedType
import glsl.plugin.psi.named.types.builtins.GlslVector
import glsl.plugin.utils.GlslUtils.getIndexedType
import glsl.plugin.utils.GlslUtils.getType
import glsl.psi.interfaces.GlslConstructorCall
import glsl.psi.interfaces.GlslFunctionCall
import glsl.psi.interfaces.GlslPostfixArrayIndex
import glsl.psi.interfaces.GlslPostfixExpr
import glsl.psi.interfaces.GlslPostfixFieldSelection
import glsl.psi.interfaces.GlslPostfixInc
import glsl.psi.interfaces.GlslPrimaryExpr
import glsl.psi.interfaces.GlslVisitor

/** Reports vector members that are not valid for the vector's component count or namespace. */
class GlslInspectionInvalidSwizzle : GlslInspection() {
    override val errorMessageCode = GlslErrorCode.INVALID_SWIZZLE

    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor {
        return object : GlslVisitor() {
            override fun visitPostfixFieldSelection(selection: GlslPostfixFieldSelection) {
                var currentType = getPostfixType(selection.postfixExpr)
                for (member in selection.postfixStructMemberList) {
                    val identifier = member.variableIdentifier ?: continue
                    val memberName = identifier.getName()
                    if (currentType is GlslVector && !isValidVectorMember(currentType, memberName)) {
                        holder.registerProblem(
                            identifier,
                            errorMessageCode.message(memberName, currentType.name ?: ""),
                            GENERIC_ERROR,
                        )
                        currentType = null
                    } else {
                        currentType = currentType?.getStructMember(memberName)?.getAssociatedType()
                    }
                }
            }
        }
    }

    private fun isValidVectorMember(vector: GlslVector, memberName: String): Boolean {
        if (memberName == "length") return true
        if (memberName.length !in 1..4) return false
        val namespace = SWIZZLE_NAMESPACES.firstOrNull { memberName.first() in it } ?: return false
        return memberName.all { component -> namespace.indexOf(component) in 0 until vector.getDimension() }
    }

    private fun getPostfixType(postfixExpr: GlslPostfixExpr?): GlslNamedType? {
        return when (postfixExpr) {
            is GlslPrimaryExpr -> {
                val variable = postfixExpr.variableIdentifier as? GlslVariable
                variable?.resolveReference()?.getAssociatedType() ?: postfixExpr.expr?.getExprType()
            }
            is GlslConstructorCall -> getType(postfixExpr.typeSpecifier)
            is GlslFunctionCall -> {
                val variable = postfixExpr.variableIdentifier as? GlslVariable
                variable?.resolveReference()?.getAssociatedType()
            }
            is GlslPostfixArrayIndex -> getIndexedType(postfixExpr, getPostfixType(postfixExpr.postfixExpr))
            is GlslPostfixFieldSelection -> {
                var type = getPostfixType(postfixExpr.postfixExpr)
                for (member in postfixExpr.postfixStructMemberList) {
                    val name = member.variableIdentifier?.getName() ?: return null
                    type = type?.getStructMember(name)?.getAssociatedType() ?: return null
                }
                type
            }
            is GlslPostfixInc -> getPostfixType(postfixExpr.postfixExpr)
            else -> null
        }
    }

    companion object {
        private val SWIZZLE_NAMESPACES = listOf("xyzw", "rgba", "stpq")
    }
}
