package glsl.plugin.preview.analysis

import com.intellij.psi.PsiElement
import com.intellij.psi.tree.TokenSet
import com.intellij.psi.util.childrenOfType
import glsl.GlslTypes
import glsl.plugin.language.GlslFile
import glsl.psi.interfaces.GlslArraySpecifier
import glsl.psi.interfaces.GlslDeclaration
import glsl.psi.interfaces.GlslExternalDeclaration
import glsl.psi.interfaces.GlslInitDeclaratorVariable
import glsl.psi.interfaces.GlslTypeQualifier

enum class GlslInterfaceStorage {
    UNIFORM,
    IN,
    OUT,
    BUFFER,
    ATTRIBUTE,
    VARYING,
}

data class GlslInterfaceVariable(
    val storage: GlslInterfaceStorage,
    val name: String,
    val typeText: String,
    val arrayText: String?,
    val layout: Map<String, String?>,
    val isBuiltin: Boolean,
)

enum class GlslInterfaceDiagnosticKind {
    SKIPPED_INTERFACE_BLOCK,
}

data class GlslInterfaceDiagnostic(
    val kind: GlslInterfaceDiagnosticKind,
    val message: String,
    val offset: Int,
)

data class GlslInterfaceScanResult(
    val variables: List<GlslInterfaceVariable>,
    val diagnostics: List<GlslInterfaceDiagnostic>,
)

object GlslInterfaceScanner {
    private val builtinUniformNames = setOf("tick", "time")

    private val storageByToken = linkedMapOf(
        GlslTypes.UNIFORM to GlslInterfaceStorage.UNIFORM,
        GlslTypes.IN to GlslInterfaceStorage.IN,
        GlslTypes.OUT to GlslInterfaceStorage.OUT,
        GlslTypes.BUFFER to GlslInterfaceStorage.BUFFER,
        GlslTypes.ATTR to GlslInterfaceStorage.ATTRIBUTE,
        GlslTypes.VARYING to GlslInterfaceStorage.VARYING,
    )

    private val storageTokens = TokenSet.create(*storageByToken.keys.toTypedArray())

    fun scan(
        file: GlslFile,
        includeSkippedBlockDiagnostics: Boolean = true,
    ): GlslInterfaceScanResult {
        val variables = mutableListOf<GlslInterfaceVariable>()
        val diagnostics = mutableListOf<GlslInterfaceDiagnostic>()

        for (externalDeclaration in file.childrenOfType<GlslExternalDeclaration>()) {
            val declaration = externalDeclaration.declaration ?: continue
            val interfaceBlock = declaration.blockStructureWrapper
            if (interfaceBlock != null) {
                if (includeSkippedBlockDiagnostics) {
                    val blockName = interfaceBlock.blockStructure.name.orEmpty()
                    diagnostics += GlslInterfaceDiagnostic(
                        kind = GlslInterfaceDiagnosticKind.SKIPPED_INTERFACE_BLOCK,
                        message = "已跳过接口块 '$blockName'",
                        offset = interfaceBlock.textOffset,
                    )
                }
                continue
            }

            scanOrdinaryDeclaration(declaration, variables)
        }

        return GlslInterfaceScanResult(variables, diagnostics)
    }

    private fun scanOrdinaryDeclaration(
        declaration: GlslDeclaration,
        result: MutableList<GlslInterfaceVariable>,
    ) {
        val firstDeclaration = declaration.singleDeclaration ?: return
        val qualifier = firstDeclaration.typeQualifier ?: return
        val storage = storageOf(qualifier) ?: return
        val layout = layoutOf(qualifier)
        val typeArray = firstDeclaration.typeSpecifier.arraySpecifier
        val typeText = firstDeclaration.typeSpecifier.text
            .removeSuffix(typeArray?.text.orEmpty())
            .trimEnd()

        addVariable(
            result = result,
            storage = storage,
            name = firstDeclaration.name,
            typeText = typeText,
            arrayText = combineArrays(typeArray, firstDeclaration.arraySpecifier),
            layout = layout,
        )

        for (variable in declaration.initDeclaratorVariableList) {
            addVariable(
                result = result,
                storage = storage,
                name = variable.name,
                typeText = typeText,
                arrayText = combineArrays(typeArray, findFollowingArray(variable)),
                layout = layout,
            )
        }
    }

    private fun addVariable(
        result: MutableList<GlslInterfaceVariable>,
        storage: GlslInterfaceStorage,
        name: String?,
        typeText: String,
        arrayText: String?,
        layout: Map<String, String?>,
    ) {
        if (name.isNullOrBlank() || typeText.isBlank()) return
        result += GlslInterfaceVariable(
            storage = storage,
            name = name,
            typeText = typeText,
            arrayText = arrayText,
            layout = layout,
            isBuiltin = storage == GlslInterfaceStorage.UNIFORM && name in builtinUniformNames,
        )
    }

    private fun storageOf(qualifier: GlslTypeQualifier): GlslInterfaceStorage? {
        val storageNode = qualifier.node.getChildren(storageTokens).firstOrNull() ?: return null
        return storageByToken[storageNode.elementType]
    }

    private fun layoutOf(qualifier: GlslTypeQualifier): Map<String, String?> {
        val result = linkedMapOf<String, String?>()
        for (layoutQualifier in qualifier.layoutQualifierList) {
            for (id in layoutQualifier.layoutQualifierIdList) {
                val name = id.variableIdentifier?.getName()
                    ?: if (id.node.findChildByType(GlslTypes.SHARED) != null) "shared" else continue
                result[name] = id.constantExpr?.text
            }
        }
        return result
    }

    private fun combineArrays(
        typeArray: GlslArraySpecifier?,
        variableArray: GlslArraySpecifier?,
    ): String? {
        return listOfNotNull(variableArray?.text, typeArray?.text)
            .joinToString("")
            .ifEmpty { null }
    }

    private fun findFollowingArray(variable: GlslInitDeclaratorVariable): GlslArraySpecifier? {
        var sibling: PsiElement? = variable.nextSibling
        while (sibling != null && sibling.text != "," && sibling.text != ";") {
            if (sibling is GlslArraySpecifier) return sibling
            sibling = sibling.nextSibling
        }
        return null
    }
}
