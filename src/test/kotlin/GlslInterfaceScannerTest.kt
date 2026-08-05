import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.plugin.language.GlslFile
import glsl.plugin.preview.analysis.GlslInterfaceDiagnosticKind
import glsl.plugin.preview.analysis.GlslInterfaceScanner
import glsl.plugin.preview.analysis.GlslInterfaceStorage

class GlslInterfaceScannerTest : BasePlatformTestCase() {

    fun testScansTopLevelOrdinaryInterfaceDeclarations() {
        val file = myFixture.configureByText(
            "Interface.vert",
            """
                layout(location = 0) in vec3 position;
                layout(location = SLOT, component) out vec4 color;
                uniform mat4 model, views[2];
                uniform float tick;
                uniform float time;
                layout(shared) uniform vec4 sharedValue;
                attribute vec2 legacyPosition;
                varying vec2 legacyUv;
                buffer uint counter;

                void main() {
                    uniform float localUniform;
                    float localValue;
                }
            """.trimIndent(),
        ) as GlslFile

        val variables = GlslInterfaceScanner.scan(file).variables

        assertEquals(
            listOf(
                "position",
                "color",
                "model",
                "views",
                "tick",
                "time",
                "sharedValue",
                "legacyPosition",
                "legacyUv",
                "counter",
            ),
            variables.map { it.name },
        )
        assertEquals(GlslInterfaceStorage.IN, variables[0].storage)
        assertEquals("vec3", variables[0].typeText)
        assertEquals(mapOf("location" to "0"), variables[0].layout)
        assertEquals(GlslInterfaceStorage.OUT, variables[1].storage)
        assertEquals(mapOf("location" to "SLOT", "component" to null), variables[1].layout)
        assertEquals("[2]", variables.first { it.name == "views" }.arrayText)
        assertTrue(variables.first { it.name == "tick" }.isBuiltin)
        assertTrue(variables.first { it.name == "time" }.isBuiltin)
        assertFalse(variables.first { it.name == "model" }.isBuiltin)
        assertEquals(mapOf("shared" to null), variables.first { it.name == "sharedValue" }.layout)
        assertEquals(GlslInterfaceStorage.ATTRIBUTE, variables.first { it.name == "legacyPosition" }.storage)
        assertEquals(GlslInterfaceStorage.VARYING, variables.first { it.name == "legacyUv" }.storage)
        assertEquals(GlslInterfaceStorage.BUFFER, variables.first { it.name == "counter" }.storage)
    }

    fun testAssociatesEachArrayWithItsDeclarator() {
        val file = myFixture.configureByText(
            "Arrays.frag",
            "uniform vec4 colors[4], weights[COUNT], single;",
        ) as GlslFile

        val variables = GlslInterfaceScanner.scan(file).variables

        assertEquals(listOf("colors", "weights", "single"), variables.map { it.name })
        assertEquals(listOf("[4]", "[COUNT]", null), variables.map { it.arrayText })
        assertTrue(variables.all { it.typeText == "vec4" })
    }

    fun testCombinesDeclaratorAndTypeArraysInGlslOrder() {
        val file = myFixture.configureByText(
            "TypeArrays.frag",
            "uniform vec4 [2] values[3], inherited;",
        ) as GlslFile

        val variables = GlslInterfaceScanner.scan(file).variables

        assertEquals(listOf("values", "inherited"), variables.map { it.name })
        assertEquals(listOf("[3][2]", "[2]"), variables.map { it.arrayText })
        assertTrue(variables.all { it.typeText == "vec4" })
    }

    fun testSkipsInterfaceBlocksAndCanSuppressTheirDiagnostics() {
        val file = myFixture.configureByText(
            "Blocks.frag",
            """
                layout(std140, binding = 2) uniform Params {
                    float exposure;
                } params;
                layout(std430, binding = 3) buffer Values {
                    float values[];
                } values;
                uniform sampler2D sourceTexture;
            """.trimIndent(),
        ) as GlslFile

        val result = GlslInterfaceScanner.scan(file)

        assertEquals(listOf("sourceTexture"), result.variables.map { it.name })
        assertEquals(2, result.diagnostics.size)
        assertTrue(result.diagnostics.all { it.kind == GlslInterfaceDiagnosticKind.SKIPPED_INTERFACE_BLOCK })
        assertEmpty(
            GlslInterfaceScanner.scan(
                file,
                includeSkippedBlockDiagnostics = false,
            ).diagnostics,
        )
    }
}
