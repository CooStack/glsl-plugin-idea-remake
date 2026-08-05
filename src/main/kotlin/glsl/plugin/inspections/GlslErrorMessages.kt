package glsl.plugin.inspections

import glsl.plugin.GlslBundle

data class GlslError(
    val errorCode: GlslErrorCode,
    val formattedMessage: String
)

enum class GlslErrorCode(private val key: String) {
    INCOMPATIBLE_TYPES_IN_INIT("error.incompatible.types.in.init"),
    MISSING_RETURN_FUNCTION("error.missing.return.function"),
    NO_MATCHING_FUNCTION_CALL("error.no.matching.function.call"),
    DOES_NOT_OPERATE_ON("error.does.not.operate.on"),
    TOO_FEW_ARGUMENTS_CONSTRUCTOR("error.too.few.arguments.constructor"),
    TOO_MANY_ARGUMENTS_CONSTRUCTOR("error.too.many.arguments.constructor"),
    PRIMITIVE_CONSTRUCTOR_ZERO_ARGUMENTS("error.primitive.constructor.zero.arguments"),
    REDECLARED_IDENTIFIER("error.redeclared.identifier"),
    MAIN_MUST_RETURN_VOID("error.main.must.return.void"),
    INCOMPATIBLE_TYPES_IN_ASSIGNMENT("error.incompatible.types.in.assignment"),
    CANT_ACCESS_ARRAY_OF_TYPE("error.cant.access.array.of.type"),
    TYPES_CONDITIONAL_EXPR_NO_MATCH("error.types.conditional.expr.no.match"),
    CONDITION_MUST_BE_BOOL("error.condition.must.be.bool"),
    INVALID_TYPES_ARGUMENT_CONSTRUCTOR("error.invalid.types.argument.constructor"),
    CANT_ACCESS_ARRAY_ELEMENT("error.cant.access.array.element"),
    INVALID_CALL_OF("error.invalid.call.of"),
    INVALID_SWIZZLE("error.invalid.swizzle"),
    UNRESOLVED_SYMBOL("error.unresolved.symbol"),
    UNRESOLVED_TYPE("error.unresolved.type"),
    ;

    fun message(vararg params: Any): String = GlslBundle.message(key, *params)
}
