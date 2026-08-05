import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.data.ShaderType
import glsl.plugin.language.GlslFile
import glsl.plugin.language.GlslFileType
import glsl.plugin.utils.GlslBuiltinUtils
import glsl.plugin.utils.GlslUtils

class GlslFileExtensionTest : BasePlatformTestCase() {

    fun testLongShaderExtensionsAreRegistered() {
        listOf("vertex", "fragment").forEach { extension ->
            val file = myFixture.configureByText("Shader.$extension", "void main() {}")

            assertInstanceOf(file, GlslFile::class.java)
            assertInstanceOf(file.fileType, GlslFileType::class.java)
            assertTrue(GlslUtils.isShaderFile(file))
        }
    }

    fun testRegisteredShaderExtensionsMapToTheirStages() {
        val expectedStages = mapOf(
            ShaderType.GLSL to listOf("glsl"),
            ShaderType.VERT to listOf("vert", "vsh", "vertex"),
            ShaderType.TESC to listOf("tesc"),
            ShaderType.TESE to listOf("tese"),
            ShaderType.GEOM to listOf("geom", "gsh"),
            ShaderType.FRAG to listOf("frag", "fsh", "fragment"),
            ShaderType.COMP to listOf("comp"),
        )

        expectedStages.forEach { (stage, extensions) ->
            extensions.forEach { extension ->
                assertEquals(stage, ShaderType.fromFileExtension(extension))
            }
        }
    }

    fun testLongShaderExtensionsUseStageSpecificBuiltinVariables() {
        val vertexVariables = GlslBuiltinUtils.getShaderVariables(project, "vertex")
        val fragmentVariables = GlslBuiltinUtils.getShaderVariables(project, "fragment")

        assertContainsElements(vertexVariables.keys, "gl_Position")
        assertFalse(vertexVariables.containsKey("gl_FragCoord"))
        assertContainsElements(fragmentVariables.keys, "gl_FragCoord")
        assertFalse(fragmentVariables.containsKey("gl_Position"))
    }
}
