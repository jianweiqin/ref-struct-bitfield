const assert = require("assert");

module.exports = function (ref) {

	return function Bitfield (type, bits) {
		if (!bits) {
			bits = 1;
		}
		type = ref.coerceType(type);

		assert(1 === type.indirection, "'type' must not be a pointer");

		return {
			bits: bits,
			type: type,
			size: type.size,
			alignment: type.alignment,
			indirection: 1,

			get (buffer, offset) {
				throw "Cannot call the get() function of a 'bitfield' type.";
			},

			set (buffer, offset, value) {
				throw "Cannot call the set() function of a 'bitfield' type.";
			},
		};
	};
};
