package glsl.plugin.inspections

import com.intellij.codeInspection.ProblemHighlightType.GENERIC_ERROR
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.psi.PsiElementVisitor
import glsl.psi.interfaces.GlslAssignmentExpr
import glsl.psi.interfaces.GlslDeclaration
import glsl.psi.interfaces.GlslSingleDeclaration
import glsl.psi.interfaces.GlslVisitor

/**
 *
 */
class GlslInspectionIncompatibleType : GlslInspection() {
    override val errorMessageCode = GlslErrorCode.INCOMPATIBLE_TYPES_IN_INIT

    /**
     *
     */
    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor {
        return object : GlslVisitor() {
            override fun visitSingleDeclaration(singleDeclaration: GlslSingleDeclaration) {
                var expr = singleDeclaration.exprNoAssignmentList.firstOrNull()
                if (expr == null) {
                    expr = (singleDeclaration.parent as GlslDeclaration).exprNoAssignmentList.firstOrNull() ?: return
                }
                val declarationType = singleDeclaration.getAssociatedType() ?: return
                val exprType = expr.getExprType() ?: return
                if (declarationType.isEqual(exprType)) return
                holder.registerProblem(expr, GlslErrorCode.INCOMPATIBLE_TYPES_IN_INIT.message(), GENERIC_ERROR)
            }

            override fun visitAssignmentExpr(assignmentExpr: GlslAssignmentExpr) {
                if (assignmentExpr.assignmentOperator.text != "=") return
                val leftExpr = assignmentExpr.exprNoAssignmentList.firstOrNull() ?: return
                val rightExpr = assignmentExpr.exprNoAssignmentList.getOrNull(1) ?: return
                val leftType = leftExpr.getExprType() ?: return
                val rightType = rightExpr.getExprType() ?: return
                if (leftType.isEqual(rightType)) return

                val message = GlslErrorCode.INCOMPATIBLE_TYPES_IN_ASSIGNMENT.message(
                    leftType.name ?: "",
                    rightType.name ?: "",
                )
                holder.registerProblem(rightExpr, message, GENERIC_ERROR)
            }
        }
    }
}
