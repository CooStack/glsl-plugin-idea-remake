import com.intellij.psi.PsiErrorElement
import com.intellij.psi.codeStyle.CodeStyleSettings
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.GlslTypes
import glsl.data.GlslTokenSets
import glsl.plugin.editor.highlighting.GlslSyntaxHighlighter
import glsl.plugin.editor.highlighting.GlslTextAttributes
import glsl.plugin.editor.style.GlslCodeStyleProvider
import glsl.plugin.language.GlslLanguage

class GlslModernCompatibilityTest : BasePlatformTestCase() {

    fun testCodeStyleProviderHasStableConfigurableId() {
        val provider = GlslCodeStyleProvider()

        assertSame(GlslLanguage.INSTANCE, provider.language)
        assertEquals(
            CodeStyleSettings.generateConfigurableIdByLanguage(GlslLanguage.INSTANCE),
            provider.configurableId,
        )
    }

    fun testOpenGl46MeshShaderQualifiers() {
        val file = myFixture.configureByText(
            "ModernShader.glsl",
            """
                #version 460 core
                #extension GL_EXT_mesh_shader : require

                struct Payload {
                    uint drawCount;
                };

                taskPayloadSharedEXT Payload payload;
                perprimitiveEXT out vec3 triangleNormal[];

                void main() {
                    bool uniformResult = allInvocationsEqual(true);
                    float fusedResult = fma(1.0, 2.0, 3.0);
                }
            """.trimIndent(),
        )

        val errors = PsiTreeUtil.findChildrenOfType(file, PsiErrorElement::class.java)
        assertTrue(errors.joinToString("\n") { it.errorDescription }, errors.isEmpty())
    }

    fun testMeshShaderQualifiersAreHighlightedAsKeywords() {
        val highlighter = GlslSyntaxHighlighter()
        val lexer = highlighter.highlightingLexer
        lexer.start("taskPayloadSharedEXT perprimitiveEXT")

        assertEquals(GlslTypes.TASKPAYLOADSHAREDEXT, lexer.tokenType)
        assertContainsElements(
            highlighter.getTokenHighlights(lexer.tokenType!!).asList(),
            GlslTextAttributes.KEYWORD_TEXT_ATTR,
        )

        lexer.advance()
        lexer.advance()

        assertEquals(GlslTypes.PERPRIMITIVEEXT, lexer.tokenType)
        assertContainsElements(
            highlighter.getTokenHighlights(lexer.tokenType!!).asList(),
            GlslTextAttributes.KEYWORD_TEXT_ATTR,
        )
        assertTrue(GlslTokenSets.TYPE_QUALIFIERS.contains(GlslTypes.TASKPAYLOADSHAREDEXT))
        assertTrue(GlslTokenSets.TYPE_QUALIFIERS.contains(GlslTypes.PERPRIMITIVEEXT))
    }
}
