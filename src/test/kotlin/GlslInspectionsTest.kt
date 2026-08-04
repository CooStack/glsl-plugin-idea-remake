import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.plugin.inspections.*

class GlslInspectionsTest : BasePlatformTestCase() {

    override fun getTestDataPath(): String {
        return "src/test/testData/inspections"
    }

    fun testDoesNotOperate() {
        myFixture.enableInspections(GlslInspectionOperatorDoesNotOperate())
        myFixture.configureByFiles("InspectionsTestDoesNotOperate.glsl")
        myFixture.checkHighlighting(false, false, false)
    }

    fun testIncompatibleTypes() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByFiles("InspectionsTestIncompatibleTypes.glsl")
        myFixture.checkHighlighting(false, false, false)
    }

    fun testNoMatchingFunction() {
//        myFixture.enableInspections(GlslInspectionNoMatchingFunction())
//        myFixture.configureByFiles("InspectionsNoMatchingFunction.glsl", "InspectionsNoMatchingFunction2.glsl")
//        myFixture.checkHighlighting(false, false, false)
    }

    fun testMissingReturn() {
        myFixture.enableInspections(GlslInspectionMissingReturn())
        myFixture.configureByFiles("InspectionsTestMissingReturn.glsl")
        myFixture.checkHighlighting(false, false, false)
    }

    fun testPrimitiveConstructorZeroArguments() {
        myFixture.enableInspections(GlslInspectionConstructorNoArguments())
        myFixture.configureByFiles("InspectionPrimitiveConstructorNoArguments.glsl")
        myFixture.checkHighlighting(false, false, false)
    }

    fun testSwizzleTypeMismatchDoesNotCascade() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByText(
            "SwizzleTypeMismatch.fsh",
            """
                float legalImplicitConversion = 1;
                vec3 first = <error descr="Incompatible types in initialization (and no available implicit conversion).">vec3(0.).r</error>;
                vec3 second = <error descr="Incompatible types in initialization (and no available implicit conversion).">vec4(0., 0., 0.).r</error>;
                float validAfterError = fract(vec2(0.).x);
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testVectorIndexHasScalarType() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByText(
            "VectorIndexType.fsh",
            """
                float scalar = vec4(0.)[0];
                vec3 vector = <error descr="Incompatible types in initialization (and no available implicit conversion).">vec4(0.)[0]</error>;
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testInvalidVectorSwizzleIsHighlighted() {
        myFixture.enableInspections(GlslInspectionInvalidSwizzle())
        myFixture.configureByText(
            "InvalidVectorSwizzle.fsh",
            """
                vec3 value = vec3(0.).<error descr="Swizzle 'argb' is not valid for vector type 'vec3'.">argb</error>;
                vec3 legalIntegerScalarConstructor = vec3(0);
                float validAfterError = fract(vec2(0.).x);
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testExtendedVectorSwizzleUsesVectorDimension() {
        myFixture.enableInspections(GlslInspectionInvalidSwizzle())
        myFixture.configureByText(
            "ExtendedVectorSwizzle.glsl",
            """
                i64vec2 value = i64vec2(0);
                int64_t component = value.x;
                int64_t invalid = value.<error descr="Swizzle 'z' is not valid for vector type 'i64vec2'.">z</error>;
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

}
