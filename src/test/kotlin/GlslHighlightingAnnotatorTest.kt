import com.intellij.testFramework.fixtures.BasePlatformTestCase

class GlslHighlightingAnnotatorTest : BasePlatformTestCase() {

    fun testUnresolvedAssignmentTargetIsHighlightedAsError() {
        myFixture.configureByText(
            "UnresolvedAssignmentTarget.vert",
            """
                #version 330 core
                layout (location = 0) in vec3 pos;
                layout (location = 1) in vec2 aUv;

                out vec2 tex_uv;
                void main() {
                    gl_Position = vec4(pos.xy, 0., 1.);
                    <error descr="Cannot resolve symbol 'screen_uv'.">screen_uv</error> = aUv;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testUnresolvedExpressionIsHighlightedAsError() {
        myFixture.configureByText(
            "UnresolvedExpression.glsl",
            "void main() { float value = <error descr=\"Cannot resolve symbol 'missing'.\">missing</error>; }",
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testResolvedReferencesAndLayoutQualifierAreNotErrors() {
        myFixture.configureByText(
            "ResolvedReferences.vert",
            """
                layout (location = 0) in vec4 position;
                void main() {
                    vec4 value;
                    value = position;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testUnresolvedTypeInRecoveredDeclarationIsHighlightedAsError() {
        myFixture.configureByText(
            "UnresolvedType.glsl",
            """
                out vec4 FragColor;
                void main() {
                    <error descr="Cannot resolve type 'abcd'.">abcd</error>
                    FragColor = vec4(1.0);
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }
}
