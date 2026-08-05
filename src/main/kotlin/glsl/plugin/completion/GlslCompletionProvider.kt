package glsl.plugin.completion

import com.intellij.codeInsight.completion.CompletionParameters
import com.intellij.codeInsight.completion.CompletionProvider
import com.intellij.codeInsight.completion.CompletionResultSet
import com.intellij.codeInsight.completion.InsertHandler
import com.intellij.codeInsight.completion.PlainPrefixMatcher
import com.intellij.codeInsight.lookup.LookupElement
import com.intellij.codeInsight.completion.PrioritizedLookupElement
import com.intellij.codeInsight.template.TemplateManager
import com.intellij.icons.AllIcons
import com.intellij.psi.PsiComment
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiWhiteSpace
import com.intellij.psi.util.PsiTreeUtil.getParentOfType
import com.intellij.psi.util.PsiTreeUtil.nextLeaf
import com.intellij.psi.util.PsiTreeUtil.prevVisibleLeaf
import com.intellij.util.ProcessingContext
import glsl.GlslTypes.IDENTIFIER
import glsl.GlslTypes.INTCONSTANT
import glsl.data.GlslDefinitions
import glsl.data.GlslTokenSets
import glsl.plugin.language.GlslIcon
import glsl.plugin.psi.named.GlslNamedType
import glsl.plugin.utils.GlslBuiltinUtils
import glsl.plugin.utils.GlslUtils
import glsl.plugin.utils.GlslUtils.createLookupElement
import glsl.plugin.utils.GlslUtils.createLookupElements
import glsl.plugin.utils.GlslUtils.getVectorInsertHandler
import glsl.plugin.utils.GlslUtils.getType
import glsl.psi.interfaces.GlslConstructorCall
import glsl.psi.interfaces.GlslAssignmentExpr
import glsl.psi.interfaces.GlslExpr
import glsl.psi.interfaces.GlslFuncHeaderWithParams
import glsl.psi.interfaces.GlslFunctionCall
import glsl.psi.interfaces.GlslSingleDeclaration
import glsl.psi.interfaces.GlslStatement
import glsl.psi.interfaces.GlslStructSpecifier
import glsl.psi.interfaces.GlslTypeName
import glsl.psi.interfaces.GlslTypeSpecifier
import javax.swing.Icon


/**
 *
 */
abstract class GlslCompletionProvider : CompletionProvider<CompletionParameters>()

/**
 *
 */
class GlslGenericCompletion(private vararg var keywords: String, private val icon: Icon? = null) : GlslCompletionProvider() {

    /**
     *
     */
    override fun addCompletions(parameters: CompletionParameters, context: ProcessingContext, resultSet: CompletionResultSet) {
        resultSet.addAllElements(keywords.map { createLookupElement(it, psiElement = parameters.position, icon = icon) })
    }
}

/**
 *
 */
class GlslPpCompletion : GlslCompletionProvider() {

    private val preprocessors = GlslUtils.getTokenSetAsStrings(GlslTokenSets.PREPROCESSORS)
        .map { it.lowercase().replace("pp_", "") }
        .toTypedArray()

    private val insertHandler = InsertHandler<LookupElement> { context, lookupElement ->
        context.document.replaceString(context.startOffset, context.selectionEndOffset, "${lookupElement.lookupString} ")
    }

    /**
     *
     */
    override fun addCompletions(parameters: CompletionParameters, context: ProcessingContext, resultSet: CompletionResultSet) {
        resultSet.addAllElements(preprocessors.map {
            createLookupElement(it.drop(1), insertHandler, psiElement = parameters.position)
        })
    }
}


/**
 *
 */
class GlslBuiltinFuncCompletion : GlslCompletionProvider() {
    /**
     *
     */
    override fun addCompletions(parameters: CompletionParameters, context: ProcessingContext, resultSet: CompletionResultSet) {
        val builtinFuncMap = GlslBuiltinUtils.getBuiltinFuncs(parameters.position.project)
        for ((funcName, funcOverloads) in builtinFuncMap) {
            val prefix = resultSet.prefixMatcher.prefix.lowercase()
            if (!funcName.lowercase().contains(prefix)) continue
            for (funcVariant in funcOverloads) {
                resultSet.addElement(GlslUtils.getFunctionLookupElement(funcVariant, GlslIcon.PLUGIN_FILE_ICON))
            }
        }
    }
}

class GlslStructCompletion : GlslCompletionProvider() {
    private val insertHandler = InsertHandler<LookupElement> { context, _ ->
        context.setAddCompletionChar(false)
        val templateManager = TemplateManager.getInstance(context.project)
        val template = templateManager.createTemplate("", "GLSL", "struct \$NAME\$ {\n    \$END\$\n};")
        template.addVariable("NAME", "", "", true)
        template.isToReformat = true

        context.document.deleteString(context.startOffset, context.tailOffset)
        context.editor.caretModel.moveToOffset(context.startOffset)
        context.setTailOffset(context.startOffset)
        templateManager.startTemplate(context.editor, template)
    }

    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        resultSet: CompletionResultSet,
    ) {
        val item = createLookupElement("struct", insertHandler, psiElement = parameters.position)
        resultSet.addElement(PrioritizedLookupElement.withPriority(item, 200.0))
    }
}

class GlslStructNameCompletionBlocker : GlslCompletionProvider() {
    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        resultSet: CompletionResultSet,
    ) {
        if (GlslCompletionContext.isStructNamePosition(parameters.position)) {
            resultSet.stopHere()
        }
    }
}

class GlslVersionCompletion : GlslCompletionProvider() {
    private val insertHandler = InsertHandler<LookupElement> { context, lookupElement ->
        val document = context.document
        val lineStart = document.getLineStartOffset(document.getLineNumber(context.startOffset))
        var versionStart = context.startOffset
        while (versionStart > lineStart && document.charsSequence[versionStart - 1].isDigit()) {
            versionStart--
        }
        document.replaceString(versionStart, context.selectionEndOffset, lookupElement.lookupString)
    }

    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        resultSet: CompletionResultSet,
    ) {
        val document = parameters.editor.document
        if (parameters.offset == 0 || !document.charsSequence[parameters.offset - 1].isDigit()) return

        val previousLeaf = prevVisibleLeaf(parameters.position)
        val versionPrefix = if (previousLeaf?.node?.elementType == INTCONSTANT) previousLeaf.text else ""
        val strictResultSet = resultSet.withPrefixMatcher(PlainPrefixMatcher(versionPrefix, true))
        strictResultSet.addAllElements(
            GlslDefinitions.VERSIONS.map {
                GlslUtils.createLookupElement(it, insertHandler, psiElement = parameters.position)
            },
        )
    }
}

class GlslConstructorCompletion : GlslCompletionProvider() {
    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        resultSet: CompletionResultSet,
    ) {
        if (!GlslCompletionContext.isConstructorExpressionPosition(parameters.position)) return
        val expectedTypeName = GlslCompletionContext.expectedTypeName(parameters.position)
        val elements = GlslDefinitions.VEC_MAT_CONSTRUCTORS.map {
            val item = createLookupElement(it, getVectorInsertHandler(), AllIcons.Nodes.Type)
            val priority = if (it == expectedTypeName) 150.0 else 100.0
            PrioritizedLookupElement.withPriority(item, priority)
        }
        resultSet.addAllElements(elements)
    }
}

/**
 *
 */
class GlslBuiltinTypesCompletion : GlslCompletionProvider() {
    private val tokens = GlslTokenSets.BUILTIN_TYPES.map { it.toString() }

    /**
     *
     */
    override fun addCompletions(parameters: CompletionParameters, context: ProcessingContext, resultSet: CompletionResultSet) {
        if (GlslCompletionContext.isConstructorExpressionPosition(parameters.position)) return
        val builtinTypes = createLookupElements(tokens.toList(), icon = AllIcons.Nodes.Type)
        resultSet.addAllElements(builtinTypes)
    }
}

internal object GlslCompletionContext {
    fun isStructNamePosition(position: PsiElement): Boolean {
        val typeName = getParentOfType(position, GlslTypeName::class.java) ?: return false
        val structSpecifier = typeName.parent as? GlslStructSpecifier ?: return false
        return structSpecifier.typeName == typeName
    }

    fun expectedTypeName(position: PsiElement): String? {
        return expectedInitializerType(position)?.name
    }

    private fun expectedInitializerType(position: PsiElement): GlslNamedType? {
        val declaration = getParentOfType(position, GlslSingleDeclaration::class.java) ?: return null
        if (declaration.typeSpecifier.textRange.contains(position.textRange.startOffset)) return null
        if (isInsideCallArgument(position)) return null
        return getType(declaration.typeSpecifier)
    }

    fun isConstructorExpressionPosition(position: PsiElement): Boolean {
        val functionHeader = getParentOfType(position, GlslFuncHeaderWithParams::class.java)
        val functionCall = getParentOfType(position, GlslFunctionCall::class.java)
        if (functionHeader != null && functionCall == null) return false

        if (getParentOfType(position, GlslConstructorCall::class.java) != null) return true
        if (getParentOfType(position, GlslTypeSpecifier::class.java) != null) return false
        if (isFollowedByIdentifier(position)) return false
        if (isAtStatementBeginning(position)) return false
        if (isOnAssignmentLeftHandSide(position)) return false

        val declaration = getParentOfType(position, GlslSingleDeclaration::class.java)
        if (declaration != null) {
            val typeSpecifier = declaration.typeSpecifier
            if (typeSpecifier.textRange.contains(position.textRange.startOffset)) {
                return false
            }
            return true
        }

        return functionCall != null ||
            getParentOfType(position, GlslExpr::class.java) != null
    }

    private fun isFollowedByIdentifier(position: PsiElement): Boolean {
        var sibling = nextLeaf(position, true)
        while (sibling is PsiWhiteSpace || sibling is PsiComment) {
            sibling = nextLeaf(sibling, true)
        }
        return sibling?.node?.elementType == IDENTIFIER
    }

    private fun isAtStatementBeginning(position: PsiElement): Boolean {
        val statement = getParentOfType(position, GlslStatement::class.java) ?: return false
        return statement.textRange.startOffset == position.textRange.startOffset
    }

    private fun isOnAssignmentLeftHandSide(position: PsiElement): Boolean {
        val assignment = getParentOfType(position, GlslAssignmentExpr::class.java) ?: return false
        return position.textRange.startOffset < assignment.assignmentOperator.textRange.startOffset
    }

    private fun isInsideCallArgument(position: PsiElement): Boolean {
        val positionOffset = position.textRange.startOffset
        val functionCall = getParentOfType(position, GlslFunctionCall::class.java)
        if (functionCall != null && functionCall.textRange.startOffset < positionOffset) return true
        val constructorCall = getParentOfType(position, GlslConstructorCall::class.java)
        return constructorCall != null && constructorCall.textRange.startOffset < positionOffset
    }
}

class GlslLayoutQualifierCompletion(private vararg val qualifiers: String) : GlslCompletionProvider() {
    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        resultSet: CompletionResultSet,
    ) {
        val prefix = resultSet.prefixMatcher.prefix.lowercase()
        resultSet.addAllElements(qualifiers.map { qualifier ->
            val item = createLookupElement(qualifier, psiElement = parameters.position)
            if (qualifier == "location" && "location".startsWith(prefix)) {
                PrioritizedLookupElement.withPriority(item, 100.0)
            } else {
                item
            }
        })
    }
}

/**
 *
 */
class GlslIncludeStatementCompletion : GlslCompletionProvider() {
    private val insertHandler = InsertHandler<LookupElement> { context, lookupElement ->
        val s = lookupElement.lookupString
        context.document.replaceString(context.startOffset, context.selectionEndOffset, s)
        context.editor.caretModel.moveToOffset(context.startOffset + s.length)
    }

    /**
     *
     */
    override fun addCompletions(parameters: CompletionParameters, context: ProcessingContext, resultSet: CompletionResultSet) {
        val virtualFile = parameters.originalFile.virtualFile
        val parentDir = virtualFile.parent ?: return
        val lookupElements = mutableListOf<LookupElement>()
        for (siblingFile in parentDir.children) {
            val siblingFileName = siblingFile.name
            if (siblingFileName == virtualFile.name) continue
            if (siblingFile.isDirectory) {
                lookupElements.add(createLookupElement("$siblingFileName/", insertHandler))
            } else {
                lookupElements.add(createLookupElement(siblingFileName))
            }
        }
        resultSet.addAllElements(lookupElements)
    }
}

