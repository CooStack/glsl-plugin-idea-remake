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

    fun testIncompatibleAssignment() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByText(
            "IncompatibleAssignment.glsl",
            """
                void main() {
                    vec4 vector = vec4(1.0);
                    vector = <error descr="Incompatible types (vec4 and int) in assignment (and no available implicit conversion).">1</error>;
                    vector = vec4(0.0);

                    float scalar = 0.0;
                    scalar = 1;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testAssignmentImplicitConversionDirection() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByText(
            "AssignmentImplicitConversion.glsl",
            """
                void main() {
                    int integer = 0;
                    integer = <error descr="Incompatible types (int and float) in assignment (and no available implicit conversion).">1.0</error>;

                    vec4 floatingVector = vec4(0.0);
                    ivec4 integerVector = ivec4(0);
                    floatingVector = integerVector;
                    integerVector = <error descr="Incompatible types (ivec4 and vec4) in assignment (and no available implicit conversion).">floatingVector</error>;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testMemberAndArrayAssignmentTypes() {
        myFixture.enableInspections(GlslInspectionIncompatibleType())
        myFixture.configureByText(
            "MemberAndArrayAssignment.glsl",
            """
                struct Material {
                    vec4 color;
                };

                void main() {
                    Material material;
                    material.color = <error descr="Incompatible types (vec4 and int) in assignment (and no available implicit conversion).">1</error>;

                    int values[2];
                    values[0] = <error descr="Incompatible types (int and float) in assignment (and no available implicit conversion).">1.0</error>;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testNoMatchingFunction() {
        myFixture.enableInspections(GlslInspectionNoMatchingFunction())
        myFixture.configureByText(
            "NoMatchingFunction.glsl",
            """
                float custom(float value) {
                    return value;
                }

                void main() {
                    float angle = 0.0;
                    float validBuiltin = sin(angle);
                    float validCustom = custom(angle);
                    <error descr="No matching function for call to ss().">ss()</error>;
                    <error descr="No matching function for call to sin(float, float).">sin(angle, angle)</error>;
                    <error descr="No matching function for call to custom(vec2).">custom(vec2(0.0))</error>;
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
    }

    fun testNoMatchingFunctionDoesNotCascadeFromUnknownArgumentType() {
        myFixture.enableInspections(GlslInspectionNoMatchingFunction())
        myFixture.configureByText(
            "NoMatchingFunctionUnknownArgument.glsl",
            """
                float custom(float value) {
                    return value;
                }

                void main() {
                    custom(<error descr="Cannot resolve symbol 'unknownValue'.">unknownValue</error>);
                }
            """.trimIndent(),
        )

        myFixture.checkHighlighting(false, false, false)
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
