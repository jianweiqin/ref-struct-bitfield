"use strict";

/**
 * An interface for modeling and instantiating C-style data structures. This is
 * not a constructor per-say, but a constructor generator. It takes an array of
 * tuples, the left side being the type, and the right side being a field name.
 * The order should be the same order it would appear in the C-style struct
 * definition. It returns a function that can be used to construct an object that
 * reads and writes to the data structure using properties specified by the
 * initial field list.
 *
 * The only verboten field names are "ref", which is used used on struct
 * instances as a function to retrieve the backing Buffer instance of the
 * struct, and "ref.buffer" which contains the backing Buffer instance.
 *
 *
 * Example:
 *
 * ``` javascript
 * var ref = require('ref')
 * var Struct = require('ref-struct')
 *
 * // create the `char *` type
 * var charPtr = ref.refType(ref.types.char)
 * var int = ref.types.int
 *
 * // create the struct "type" / constructor
 * var PasswordEntry = Struct({
 *     'username': 'string'
 *   , 'password': 'string'
 *   , 'salt':     int
 * })
 *
 * // create an instance of the struct, backed a Buffer instance
 * var pwd = new PasswordEntry()
 * pwd.username = 'ricky'
 * pwd.password = 'rbransonlovesnode.js'
 * pwd.salt = (Math.random() * 1000000) | 0
 *
 * pwd.username // → 'ricky'
 * pwd.password // → 'rbransonlovesnode.js'
 * pwd.salt     // → 820088
 * ```
 */

const util = require("util");
const assert = require("assert");
const debug = require("debug")("ref-struct-bitfield");

module.exports = function (ref) {
	Struct.bitfield = require("./bitfield")(ref);
	Struct.Union = require("./union")(ref);

	const isSignedInteger = (function () {
		const buffer = Buffer.alloc(8);
		buffer.writeBigInt64LE(-1n);

		return function (type) {
			return type.signed ?? (type.signed = getSigned(type));
		};

		function getSigned (type) {
			return -1 === ref.get(buffer, 0, type);
		}
	})();

	/**
	 * The Struct "type" meta-constructor.
	 */
	function Struct () {
		debug("defining new struct \"type\"");

		/**
		 * This is the "constructor" of the Struct type that gets returned.
		 *
		 * Invoke it with `new` to create a new Buffer instance backing the struct.
		 * Pass it an existing Buffer instance to use that as the backing buffer.
		 * Pass in an Object containing the struct fields to auto-populate the
		 * struct with the data.
		 */
		function StructType (arg, data) {
			if (!(this instanceof StructType)) {
				return new StructType(arg, data);
			}
			debug("creating new struct instance");
			let store;
			if (Buffer.isBuffer(arg)) {
				debug("using passed-in Buffer instance to back the struct", arg);
				assert(arg.length >= StructType.size,
					`Buffer instance must be at least ${StructType.size} bytes to back this struct type`);
				store = arg;
				arg = data;
			} else {
				debug("creating new Buffer instance to back the struct (size: %d)", StructType.size);
				store = Buffer.alloc(StructType.size);
			}

			// set the backing Buffer store
			store.type = StructType;
			this["ref.buffer"] = store;

			if (arg) {
				for (const key in arg) {
					// hopefully hit the struct setters
					this[key] = arg[key];
				}
			}
			StructType._instanceCreated = true;
		}

		// make instances inherit from the `proto`
		StructType.prototype = Object.create(proto, {
			constructor: {
				value: StructType
				, enumerable: false
				, writable: true
				, configurable: true,
			},
		});

		StructType.defineProperty = defineProperty;
		StructType.defineProperties = defineProperties;
		StructType.toString = toString;
		StructType.fields = {};

		const opt = (arguments.length > 0 && arguments[1]) ? arguments[1] : {};

		// Setup the ref "type" interface. The constructor doubles as the "type" object
		StructType.size = 0;
		StructType.alignment = 0;
		StructType.explicitAlignment = opt.alignment;
		StructType.currBits = 0;
		StructType.indirection = 1;
		StructType.isPacked = opt.packed ? Boolean(opt.packed) : false;
		StructType.get = get;
		StructType.set = set;

		// Read the fields list and apply all the fields to the struct
		// TODO: Better arg handling... (maybe look at ES6 binary data API?)
		const arg = arguments[0];
		if (Array.isArray(arg)) {
			// legacy API
			arg.forEach(function (a) {
				const type = a[0];
				const name = a[1];
				internalDefineProperty.bind(StructType)(name, type);
			});
		} else if (typeof arg === "object") {
			Object.keys(arg).forEach(function (name) {
				const type = arg[name];
				internalDefineProperty.bind(StructType)(name, type);
			});
		}
		recalc(StructType);

		return StructType;
	}

	/**
	 * The "get" function of the Struct "type" interface
	 */
	function get (buffer, offset) {
		debug("Struct \"type\" getter for buffer at offset", buffer, offset);
		if (offset > 0) {
			buffer = buffer.slice(offset);
		}
		return new this(buffer);
	}

	/**
	 * The "set" function of the Struct "type" interface
	 */
	function set (buffer, offset, value) {
		debug("Struct \"type\" setter for buffer at offset", buffer, offset, value);
		const isStruct = value instanceof this;
		if (isStruct) {
			// optimization: copy the buffer contents directly rather
			// than going through the ref-struct constructor
			value["ref.buffer"].copy(buffer, offset, 0, this.size);
		} else {
			if (offset > 0) {
				buffer = buffer.slice(offset);
			}
			new this(buffer, value);
		}
	}

	/**
	 * Custom `toString()` override for struct type instances.
	 */
	function toString () {
		return "[StructType]";
	}

	/**
	 * Adds a new field to the struct instance with the given name and type.
	 * Note that this function will throw an Error if any instances of the struct
	 * type have already been created, therefore this function must be called at the
	 * beginning, before any instances are created.
	 */
	function internalDefineProperty (name, type) {
		debug("defining new struct type field", name);

		// allow string types for convenience
		type = ref.coerceType(type);

		assert(!this._instanceCreated,
			"an instance of this Struct type has already been created, cannot add new \"fields\" anymore");
		assert.equal("string", typeof name, "expected a \"string\" field name");
		assert(type && /object|function/i.test(typeof type) && "size" in type && "indirection" in type,
			"expected a \"type\" object describing the field type: \"" + type + "\"");
		assert(type.indirection > 1 || type.size > 0,
			"\"type\" object must have a size greater than 0");

		const field = {type};
		this.fields[name] = field;

		// define the getter/setter property
		const desc = {enumerable: true, configurable: true};

		if (type.bits) {
			desc.get = function () {
				debug("getting \"%s\" bitfield", name);
				let value = ref.get(this["ref.buffer"], field.offset, type.type);	// 超大时，会返回字符串形式，而不是 BigInt
				value = BigInt(value);
				value = (value >> field.bitStart) & field.mask;
				if (isSignedInteger(type.type)) {
					value = BigInt.asIntN(field.bits, value);
				}
				if (type.type.size <= 4) {
					value = Number(value);
				}
				debug("got \"%s\" bitfield (value: %d)", name, value);
				return value;
			};

			desc.set = function (value) {
				debug("setting \"%s\" bitfield (value: %d)", name, value);
				let val = ref.get(this["ref.buffer"], field.offset, type.type);	// 超大时，会返回字符串形式，而不是 BigInt
				val = BigInt(val);
				val = val | ((BigInt(value) & field.mask) << field.bitStart);
				if (isSignedInteger(type.type)) {
					val = BigInt.asIntN(8 * type.type.size, val);
				}
				if (type.type.size <= 4) {
					val = Number(val);
				} else {
					val = String(val);	// 如用 String，int8 会有问题，ref 库会把小于 10 的数当成字符，最终写入的是 ASCII 码。
				}
				return ref.set(this["ref.buffer"], field.offset, val, type.type);
			};
		} else {
			desc.get = function () {
				debug("getting \"%s\" struct field (offset: %d)", name, field.offset);
				return ref.get(this["ref.buffer"], field.offset, type);
			};
			desc.set = function (value) {
				debug("setting \"%s\" struct field (offset: %d)", name, field.offset, value);
				return ref.set(this["ref.buffer"], field.offset, value, type);
			};
		}

		Object.defineProperty(this.prototype, name, desc);
	}

	function defineProperty (name, type) {
		internalDefineProperty.bind(this)(name, type);
		recalc(this);
		return this;
	}

	function defineProperties (obj) {
		const bound = internalDefineProperty.bind(this);
		Object.entries(obj).forEach(([name, type]) => bound(name, type));
		recalc(this);
		return this;
	}

	function recalc (struct) {

		// reset size and alignment
		struct.size = 0;
		struct.alignment = 0;
		clearBitfieldSettings();

		const fieldNames = Object.keys(struct.fields);

		// first loop through is to determine the `alignment` of this struct
		fieldNames.forEach(function (name) {
			const field = struct.fields[name];
			const type = field.type;
			let alignment = type.alignment || ref.alignof.pointer;
			if (type.indirection > 1) {
				alignment = ref.alignof.pointer;
			}
			if (struct.isPacked) {
				struct.alignment = Math.min(struct.alignment || alignment, alignment);
			} else {
				struct.alignment = Math.max(struct.alignment, alignment);
			}
		});

		// second loop through sets the `offset` property on each "field"
		// object, and sets the `struct.size` as we go along
		fieldNames.forEach(function (name) {
			const field = struct.fields[name];
			const type = field.type;

			if (!type.bits) {
				clearBitfieldSettings();	// 遇到非位域，清除 bits
			}

			if (null != type.fixedLength) {
				// "ref-array" types set the "fixedLength" prop. don't treat arrays like one
				// contiguous entity. instead, treat them like individual elements in the
				// struct. doing this makes the padding end up being calculated correctly.
				field.offset = addType(type.type);
				for (let i = 1; i < type.fixedLength; i++) {
					addType(type.type);
				}
			} else if (type.bits) {	// bitfield
				assert(type.bits <= type.size * 8, "bits must be less than the size of the type");

				let firstFieldInGroup = false;	// 本次是否第 1 个位域(之前没有，或者类型不一致，或者剩余位已无法容纳本次位域)
				let newCurrBits = struct.currBits + type.bits;	// 已使用的位数 + 本次所需位数

				const typeDifferent = struct.lastBitfieldType?.size !== type.size
					|| struct.lastBitfieldType?.alignment !== type.alignment;	// 本次类型与上次不一样
				const bitsInsufficient = newCurrBits > 8 * type.size;	// 剩余位数已无法容纳本次位域

				if (typeDifferent || bitsInsufficient) {
					firstFieldInGroup = true;
					struct.currBits = 0;	// 当前已使用位数清零
					newCurrBits = type.bits;
				}
				if (typeDifferent) {
					const padding = struct.isPacked ? 0 : (type.alignment - (struct.size % type.alignment)) % type.alignment;
					struct.size += padding;
				}

				if (firstFieldInGroup) {
					field.offset = struct.size;					// 新开始的
					struct.lastBitfieldOffset = field.offset;
				} else {
					field.offset = struct.lastBitfieldOffset;	// 接续的
				}
				if (firstFieldInGroup) {	// 剩余位已无法容纳本次位域
					struct.size += type.size;	// 增加总长度
				}

				field.bitStart = BigInt(struct.currBits);
				field.bits = type.bits;
				field.mask = BigInt(0);
				for (let i = 0; i < field.bits; i++) {
					field.mask = (field.mask << 1n) | 1n;
				}

				struct.lastBitfieldType = type;
				struct.currBits = newCurrBits;			// 当前已使用位数
			} else {
				field.offset = addType(type);
			}
		});

		addFinalPadding();

		function clearBitfieldSettings () {
			struct.currBits = 0;	// 当前已使用位数清零
			struct.lastBitfieldType = null;
		}

		function addType (type) {
			let offset = struct.size;
			const align = type.indirection === 1 ? type.alignment : ref.alignof.pointer;
			const padding = struct.isPacked ? 0 : (align - (offset % align)) % align;
			const size = type.indirection === 1 ? type.size : ref.sizeof.pointer;

			offset += padding;

			if (!struct.isPacked) {
				assert.equal(offset % align, 0, "offset should align");
			}

			// adjust the "size" of the struct type
			struct.size = offset + size;

			// return the calulated offset
			return offset;
		}

		function addFinalPadding () {
			const left = struct.size % struct.alignment;
			if (left > 0) {
				debug("additional padding to the end of struct:", struct.alignment - left);
				struct.size += struct.alignment - left;
			}
		}
	}

	/**
	 * this is the custom prototype of Struct type instances.
	 */
	const proto = {};

	/**
	 * set a placeholder variable on the prototype so that defineProperty() will
	 * throw an error if you try to define a struct field with the name "buffer".
	 */
	proto["ref.buffer"] = ref.NULL;

	/**
	 * Flattens the Struct instance into a regular JavaScript Object. This function
	 * "gets" all the defined properties.
	 *
	 * @api public
	 */
	proto.toObject = function toObject () {
		const obj = {};
		Object.keys(this.constructor.fields).forEach(function (k) {
			let value = this[k];
			if ("function" === typeof (value.toObject)) {
				value = value.toObject();
			}
			obj[k] = value;
		}, this);
		return obj;
	};

	/**
	 * Basic `JSON.stringify(struct)` support.
	 */
	proto.toJSON = function toJSON () {
		return this.toObject();
	};

	/**
	 * `.inspect()` override. For the REPL.
	 *
	 * @api public
	 */
	proto.inspect = function inspect () {
		const obj = this.toObject();
		// add instance's "own properties"
		Object.keys(this).forEach(function (k) {
			obj[k] = this[k];
		}, this);
		return util.inspect(obj);
	};

	/**
	 * returns a Buffer pointing to this struct data structure.
	 */
	proto.ref = function ref () {
		return this["ref.buffer"];
	};

	return Struct;
};
