package glsl.plugin.inspections

import com.intellij.codeInspection.ProblemHighlightType
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.psi.PsiElementVisitor
import glsl.psi.interfaces.GlslFunctionCall
import glsl.psi.interfaces.GlslFunctionDeclarator
import glsl.psi.interfaces.GlslVisitor

class GlslInspectionNoMatchingFunction : GlslInspection() {
    override val errorMessageCode = GlslErrorCode.NO_MATCHING_FUNCTION_CALL

    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor {
        return object : GlslVisitor() {
            override fun visitFunctionCall(functionCall: GlslFunctionCall) {
                val functionIdentifier = functionCall.variableIdentifier ?: return
                val actualTypeNames = mutableListOf<String>()
                for (expression in functionCall.exprNoAssignmentList) {
                    val typeName = expression.getExprType()?.name ?: return
                    actualTypeNames.add(typeName)
                }
                if (functionIdentifier.resolveReference() is GlslFunctionDeclarator) return

                val message = errorMessageCode.message(
                    functionIdentifier.getName(),
                    actualTypeNames.joinToString(", "),
                )
                holder.registerProblem(functionCall, message, ProblemHighlightType.GENERIC_ERROR)
            }
        }
    }
}
