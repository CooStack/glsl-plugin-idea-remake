package glsl.plugin.completion

import com.intellij.codeInsight.completion.CompletionContributor
import com.intellij.codeInsight.completion.CompletionInitializationContext
import com.intellij.codeInsight.completion.CompletionType
import com.intellij.codeInsight.completion.CompletionUtilCore
import com.intellij.patterns.PlatformPatterns.psiElement
import com.intellij.patterns.StandardPatterns.or
import com.intellij.psi.util.PsiTreeUtil.getParentOfType
import glsl.GlslTypes.*
import glsl.data.GlslTokenSets
import glsl.plugin.utils.GlslUtils
import glsl.psi.interfaces.*


/**
 *
 */
class GlslCompletionContributor : CompletionContributor() {
    // Keywords sets
    private val selectionKeywords = GlslUtils.getTokenSetAsStrings(GlslTokenSets.SELECTION)
    private val iterationKeywords = GlslUtils.getTokenSetAsStrings(GlslTokenSets.ITERATION)
    private val funcJumpsKeywords = GlslUtils.getTokenSetAsStrings(GlslTokenSets.FUNC_JUMPS)
    private val iterationJumpsKeywords = GlslUtils.getTokenSetAsStrings(GlslTokenSets.ITERATION_JUMPS)
    private val typeQualifiers = GlslUtils.getTokenSetAsStrings(GlslTokenSets.TYPE_QUALIFIERS)
    private val layoutQualifiers = arrayOf(
        "location", "component", "index", "binding", "offset", "align",
        "std140", "std430", "shared", "packed", "row_major", "column_major",
        "origin_upper_left", "pixel_center_integer", "early_fragment_tests",
        "depth_any", "depth_greater", "depth_less", "depth_unchanged",
        "points", "lines", "lines_adjacency", "triangles", "triangles_adjacency",
        "line_strip", "triangle_strip", "quads", "isolines", "equal_spacing",
        "fractional_even_spacing", "fractional_odd_spacing", "cw", "ccw",
        "point_mode", "vertices", "invocations", "max_vertices", "stream",
        "xfb_buffer", "xfb_offset", "xfb_stride",
        "local_size_x", "local_size_y", "local_size_z",
    )

    // Patterns
    private val numeric = or(
        psiElement(INTCONSTANT),
        psiElement(UINTCONSTANT),
        psiElement(FLOATCONSTANT),
        psiElement(DOUBLECONSTANT),
    )

    private val afterDot = psiElement().afterLeaf(".")
    private val afterPpLiteral = psiElement().afterLeaf("#")
    private val insidePpStatement = psiElement().inside(GlslPpStatement::class.java)
    private val afterVersion = psiElement().afterLeaf(psiElement(INTCONSTANT).afterLeaf(psiElement(PP_VERSION)))

    private val insideIteration = psiElement()
        .inside(psiElement(GlslCompoundStatementNoNewScope::class.java).withParent(GlslIterationStatement::class.java))
        .andNot(psiElement().afterLeaf(numeric))
        .andNot(afterDot)

    private val insideTypeSpecifier = psiElement(IDENTIFIER)
        .withParent(GlslTypeName::class.java)
        .andNot(psiElement().afterLeaf(numeric))
        .inside(GlslTypeSpecifier::class.java)

    private val insideExpression = psiElement(IDENTIFIER)
        .andNot(psiElement().afterLeaf(numeric))
        .andNot(afterDot)
        .inside(GlslExpr::class.java)

    private val statementBeginning = psiElement()
        .andNot(psiElement().afterLeaf(numeric))
        .atStartOf(psiElement(GlslStatement::class.java))
        .andNot(afterDot)
        .andNot(insidePpStatement)

    private val externalDeclarationBeginning = psiElement(IDENTIFIER)
        .andNot(psiElement().afterLeaf(numeric))
        .atStartOf(psiElement(GlslExternalDeclaration::class.java))
        .andNot(afterDot)
        .andNot(insidePpStatement)

    private val paramBeginning = psiElement()
        .andNot(psiElement().afterLeaf(numeric))
        .inside(psiElement(GlslFuncHeaderWithParams::class.java))
        .afterLeaf("(", ",")

    private val typeQualifiersPattern = or(
        statementBeginning,
        externalDeclarationBeginning,
        paramBeginning,
        psiElement(IDENTIFIER).afterLeaf(
            psiElement(RIGHT_PAREN).inside(GlslLayoutQualifier::class.java)
        ),
    )

    private val insideLayoutQualifier = psiElement(IDENTIFIER)
        .inside(GlslLayoutQualifierId::class.java)

    private val insideInclude = psiElement(STRING_LITERAL)
        .inside(GlslPpIncludeDeclaration::class.java)

    override fun beforeCompletion(context: CompletionInitializationContext) {
        val document = context.editor.document
        val caretOffset = context.editor.caretModel.offset
        if (caretOffset <= 0 || caretOffset > document.textLength) return

        val leaf = context.file.findElementAt(caretOffset - 1) ?: return
        if (getParentOfType(leaf, GlslFunctionDefinition::class.java) == null) return

        val lineNumber = document.getLineNumber(caretOffset)
        val lineStart = document.getLineStartOffset(lineNumber)
        val lineEnd = document.getLineEndOffset(lineNumber)
        val lineBeforeCaret = document.charsSequence.subSequence(lineStart, caretOffset)
        val beforeCaret = lineBeforeCaret.trim()
        val afterCaret = document.charsSequence.subSequence(caretOffset, lineEnd)
        if (!STANDALONE_IDENTIFIER.matches(beforeCaret) || !afterCaret.isBlank()) return

        val identifierOffset = lineStart + lineBeforeCaret.indexOfFirst { !it.isWhitespace() }
        val statement = getParentOfType(leaf, GlslStatement::class.java) ?: return
        if (statement.textRange.startOffset != identifierOffset) return

        val recoveredFunctionDeclarator = getParentOfType(leaf, GlslFunctionDeclarator::class.java) ?: return
        if (recoveredFunctionDeclarator.typeSpecifier.typeName == null) return

        context.dummyIdentifier = "${CompletionUtilCore.DUMMY_IDENTIFIER_TRIMMED};"
    }

    init {
        extend(CompletionType.BASIC, typeQualifiersPattern, GlslGenericCompletion(*typeQualifiers))
        extend(CompletionType.BASIC, insideLayoutQualifier, GlslLayoutQualifierCompletion(*layoutQualifiers))
        extend(CompletionType.BASIC, statementBeginning, GlslGenericCompletion(*selectionKeywords, *iterationKeywords, *funcJumpsKeywords))
        extend(CompletionType.BASIC, insideIteration, GlslGenericCompletion(*iterationJumpsKeywords))
        extend(CompletionType.BASIC, afterPpLiteral, GlslPpCompletion())
        extend(CompletionType.BASIC, afterVersion, GlslVersionCompletion())
        extend(CompletionType.BASIC, insideInclude, GlslIncludeStatementCompletion())
        // Builtin objects
        extend(CompletionType.BASIC, statementBeginning, GlslBuiltinTypesCompletion())
        extend(CompletionType.BASIC, insideTypeSpecifier, GlslBuiltinTypesCompletion())
        extend(CompletionType.BASIC, insideTypeSpecifier, GlslConstructorCompletion())
        extend(CompletionType.BASIC, insideExpression, GlslBuiltinFuncCompletion())
        extend(CompletionType.BASIC, insideExpression, GlslConstructorCompletion())
    }

    companion object {
        private val STANDALONE_IDENTIFIER = Regex("[A-Za-z_][A-Za-z0-9_]*")
    }
}

