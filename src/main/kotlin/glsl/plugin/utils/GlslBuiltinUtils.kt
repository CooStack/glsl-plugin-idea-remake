package glsl.plugin.utils

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.psi.PsiFileFactory
import com.intellij.psi.util.PsiTreeUtil.findChildOfType
import com.intellij.psi.util.PsiTreeUtil.findChildrenOfType
import com.intellij.psi.util.findParentOfType
import glsl.data.ShaderType
import glsl.data.ShaderType.*
import glsl.plugin.language.GlslFile
import glsl.plugin.language.GlslFileType
import glsl.plugin.psi.named.GlslNamedElement
import glsl.plugin.psi.named.GlslNamedVariable
import glsl.plugin.psi.named.types.user.GlslNamedStructSpecifier
import glsl.plugin.utils.GlslUtils.getResourceFileAsString
import glsl.psi.interfaces.GlslDeclaration
import glsl.psi.interfaces.GlslFunctionDeclarator
import glsl.psi.interfaces.GlslSingleDeclaration
import glsl.psi.interfaces.GlslStructSpecifier
import java.util.*

object GlslBuiltinUtils {

    private val builtinCacheKey = Key.create<BuiltinCache>("glsl.builtin.cache")

    private class BuiltinCache(val project: Project) {
        val vecStructs by lazy { createVecStructs(project) }
        val builtinConstants by lazy { createBuiltinConstants(project) }
        val shaderVariables by lazy { createShaderVariables(project) }
        val builtinFuncs by lazy { createBuiltinFuncs(project) }
    }

    private data class ShaderVariableCache(
        val defaults: Map<String, GlslNamedVariable>,
        val byShaderType: EnumMap<ShaderType, Map<String, GlslNamedVariable>>,
    )

    /**
     * Creates a map of the GLSL builtin functions with their name as a key and a list of their AST
     * as a value. Due to overloading, most functions have different signatures with the same name.
     * Therefore, we want to create a list of them and show all possible signatures to the user.
     */
    fun getBuiltinFuncs(project: Project): Map<String, List<GlslFunctionDeclarator>> {
        return getCache(project).builtinFuncs
    }

    private fun createBuiltinFuncs(project: Project): Map<String, List<GlslFunctionDeclarator>> {
        val funcs = mutableMapOf<String, MutableList<GlslFunctionDeclarator>>()
        val builtinFile = getBuiltinFile(project, "glsl-builtin-functions")
        val declarations = findChildrenOfType(builtinFile, GlslDeclaration::class.java)
        for (declaration in declarations) {
            val funcName = findChildOfType(declaration, GlslFunctionDeclarator::class.java)?.name ?: continue
            val functionDeclarator = declaration.functionDeclarator ?: continue
            if (funcs.containsKey(funcName)) {
                funcs[funcName]?.add(functionDeclarator)
            } else {
                funcs[funcName] = mutableListOf(functionDeclarator)
            }
        }
        return funcs
    }

    /**
     *
     */
    fun getVecStructs(project: Project): Map<String, Map<String, GlslNamedVariable>> {
        return getCache(project).vecStructs
    }

    private fun createVecStructs(project: Project): Map<String, Map<String, GlslNamedVariable>> {
        val builtinFile = getBuiltinFile(project, "glsl-vector-structs")
        val structSpecifiers = findChildrenOfType(builtinFile, GlslStructSpecifier::class.java).toList()
        val lengthFunc = findChildOfType(builtinFile, GlslFunctionDeclarator::class.java)
        val vecStructsTemp = hashMapOf<String, MutableMap<String, GlslNamedVariable>>()
        for (structSpecifier in structSpecifiers) {
            val vecName = structSpecifier.name?.lowercase() ?: continue
            for (structDeclaration in structSpecifier.structDeclarationList) {
                val structDeclarator = structDeclaration.structDeclaratorList.first()
                val structDeclaratorName = structDeclarator.name ?: continue
                vecStructsTemp.putIfAbsent(vecName, hashMapOf())
                vecStructsTemp[vecName]!![structDeclaratorName] = structDeclarator
            }
            if (lengthFunc != null && lengthFunc.name == "length") {
                vecStructsTemp[vecName]?.set("length", lengthFunc)
            }
        }
        return vecStructsTemp
    }

    /**
     *
     */
    fun getBuiltinConstants(project: Project): Map<String, GlslNamedVariable> {
        return getCache(project).builtinConstants
    }

    private fun createBuiltinConstants(project: Project): Map<String, GlslNamedVariable> {
        val builtinFile = getBuiltinFile(project, "glsl-builtin-constants")
        val singleDeclarations = findChildrenOfType(builtinFile, GlslSingleDeclaration::class.java).toList()
        val constants = hashMapOf<String, GlslNamedVariable>()
        for (child in singleDeclarations) {
            val childName = child.name
            if (childName != null) {
                constants[childName] = child
            }
        }
        return constants
    }

    fun getShaderVariables(project: Project, fileExtension: String? = null): Map<String, GlslNamedVariable> {
        val shaderVariables = getCache(project).shaderVariables
        val shaderType = getShaderType(fileExtension)
        if (shaderType == GLSL) {
            return shaderVariables.defaults
        }
        return shaderVariables.byShaderType[shaderType] ?: emptyMap()
    }

    /**
     *
     */
    private fun createShaderVariables(project: Project): ShaderVariableCache {
        val shaderVariablesFile = getBuiltinFile(project, "glsl-shader-variables")
        val structSpecifiers = findChildrenOfType(shaderVariablesFile, GlslStructSpecifier::class.java).filter { it.findParentOfType<GlslStructSpecifier>() == null }.toList()
        // Initializes map with ShaderType enum
        val shaderVariables = EnumMap<ShaderType, Map<String, GlslNamedVariable>>(ShaderType::class.java)
        val allShaderVariables = hashMapOf<String, GlslNamedVariable>()
        for (structSpecifier in structSpecifiers) {
            val namedStruct = structSpecifier as GlslNamedStructSpecifier
            val structDeclarators = hashMapOf<String, GlslNamedVariable>()
            for (structMember in structSpecifier.getStructMembers()) {
                val memberName = structMember.name ?: continue
                structDeclarators[memberName] = structMember
                allShaderVariables[memberName] = structMember
            }
            val shaderType = getShaderType(namedStruct.name)
            shaderVariables[shaderType] = structDeclarators
        }
        return ShaderVariableCache(allShaderVariables, shaderVariables)
    }

    /**
     *
     */
    fun isBuiltin(project: Project, name: String?, fileExtension: String? = null): Boolean {
        if (name == null) return false
        return isBuiltinFunction(project, name) ||
            isBuiltinShaderVariable(project, name, fileExtension) ||
            isBuiltinConstant(project, name)
    }

    /**
     *
     */
    fun isBuiltinFunction(project: Project, name: String?): Boolean {
        if (name == null) return false
        return name in getBuiltinFuncs(project).keys
    }

    /**
     *
     */
    fun isBuiltinConstant(project: Project, name: String): Boolean {
        return name in getBuiltinConstants(project).keys
    }

    /**
     *
     */
    fun isBuiltinShaderVariable(project: Project, variable: String, fileExtension: String?): Boolean {
        if (fileExtension == null) return false
        val shaderVariables = getCache(project).shaderVariables
        fun isAinB(a: String, b: Map<String, GlslNamedElement>?): Boolean = if (b != null) a in b.keys else false
        return when (val shaderType = getShaderType(fileExtension)) {
            VERT -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            GEOM -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            FRAG -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            TESC -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            TESE -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            COMP -> isAinB(variable, shaderVariables.byShaderType[shaderType])
            GLSL -> isAinB(variable, shaderVariables.defaults)
        }
    }

    /**
     *
     */
    private fun getBuiltinFile(project: Project, fileName: String): GlslFile? {
        val funcsString = getResourceFileAsString("builtin-objects/$fileName.glsl") ?: return null
        val fileFactory = PsiFileFactory.getInstance(project)
        val glslFile = fileFactory.createFileFromText(fileName, GlslFileType(), funcsString) as? GlslFile
        glslFile?.viewProvider?.virtualFile?.isWritable = false
        glslFile?.viewProvider
        return glslFile
    }

    private fun getCache(project: Project): BuiltinCache {
        project.getUserData(builtinCacheKey)?.let { return it }
        return synchronized(builtinCacheKey) {
            project.getUserData(builtinCacheKey) ?: BuiltinCache(project).also {
                project.putUserData(builtinCacheKey, it)
            }
        }
    }

    /**
     *
     */
    private fun getShaderType(fileExtension: String?): ShaderType {
        if (fileExtension == null) return GLSL
        return try {
            valueOf(fileExtension.lowercase())
        } catch (_: IllegalArgumentException) {
            GLSL
        }
    }
}
