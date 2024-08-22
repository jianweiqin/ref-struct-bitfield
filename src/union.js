"use strict";

const util = require("util");
const assert = require("assert");
const debug = require("debug")("ref-union");

module.exports = function (ref) {

	/**
	 * The "Union" type constructor.
	 */
	function Union () {
		debug("defining new union \"type\"");

		function UnionType (arg, data) {
			if (!(this instanceof UnionType)) {
				return new UnionType(arg, data);
			}
			debug("creating new union instance");
			let store;
			if (Buffer.isBuffer(arg)) {
				debug("using passed-in Buffer instance to back the union", arg);
				assert(arg.length >= UnionType.size, "Buffer instance must be at least "
					+ UnionType.size + " bytes to back this untion type");
				store = arg;
				arg = data;
			} else {
				debug("creating new Buffer instance to back the union (size: %d)", UnionType.size);
				store = new Buffer(UnionType.size);
			}

			// set the backing Buffer store
			store.type = UnionType;
			this["ref.buffer"] = store;

			// initialise the union with values supplied
			if (arg) {
				//TODO: Sanity check - e.g. (Object.keys(arg).length == 1)
				for (const key in arg) {
					// hopefully hit the union setters
					this[key] = arg[key];
				}
			}
			UnionType._instanceCreated = true;
		}

		// make instances inherit from `proto`
		UnionType.prototype = Object.create(proto, {
			constructor: {
				value: UnionType
				, enumerable: false
				, writable: true
				, configurable: true,
			},
		});

		UnionType.defineProperty = defineProperty;
		UnionType.defineProperties = defineProperties;
		UnionType.toString = toString;
		UnionType.fields = {};

		const opt = (arguments.length > 0 && arguments[1]) ? arguments[1] : {};

		// comply with ref's "type" interface
		UnionType.size = 0;
		UnionType.alignment = 0;
		UnionType.indirection = 1;
		UnionType.isPacked = opt.packed ? Boolean(opt.packed) : false;
		UnionType.get = get;
		UnionType.set = set;

		// Read the fields list
		const arg = arguments[0];
		if (typeof arg === "object") {
			Object.keys(arg).forEach(function (name) {
				const type = arg[name];
				internalDefineProperty.bind(UnionType)(name, type);
			});
			recalc(UnionType);
		}

		return UnionType;
	}

	function get (buffer, offset) {
		debug("Union \"type\" getter for buffer at offset", buffer, offset);
		if (offset > 0) {
			buffer = buffer.slice(offset);
		}
		return new this(buffer);
	}

	function set (buffer, offset, value) {
		debug("Union \"type\" setter for buffer at offset", buffer, offset, value);
		if (offset > 0) {
			buffer = buffer.slice(offset);
		}
		const union = new this(buffer);
		const isUnion = value instanceof this;
		if (isUnion) {
			// TODO: optimize - use Buffer#copy()
			Object.keys(this.fields).forEach(function (name) {
				// hopefully hit the setters
				union[name] = value[name];
			});
		} else {
			for (const name in value) {
				// hopefully hit the setters
				union[name] = value[name];
			}
		}
	}

	function toString () {
		return "[UnionType]";
	}

	/**
	 * Adds a new field to the union instance with the given name and type.
	 * Note that this function will throw an Error if any instances of the union
	 * type have already been created, therefore this function must be called at the
	 * beginning, before any instances are created.
	 */
	function internalDefineProperty (name, type) {
		debug("defining new union type field", name);

		// allow string types for convenience
		type = ref.coerceType(type);

		assert(!this._instanceCreated,
			"an instance of this Union type has already been created, cannot add new data members anymore");
		assert.equal("string", typeof name, "expected a \"string\" field name");
		assert(type && /object|function/i.test(typeof type) && "size" in type && "indirection" in type,
			"expected a \"type\" object describing the field type: \"" + type + "\"");

		// define the getter/setter property
		Object.defineProperty(this.prototype, name, {
			enumerable: true
			, configurable: true
			, get: get
			, set: set,
		});

		const field = {
			type: type,
		};
		this.fields[name] = field;

		function get () {
			debug("getting \"%s\" union field (length: %d)", name, type.size);
			return ref.get(this["ref.buffer"], 0, type);
		}

		function set (value) {
			debug("setting \"%s\" union field (length: %d)", name, type.size, value);
			return ref.set(this["ref.buffer"], 0, value, type);
		}
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

	function recalc (union) {
		// reset size and alignment
		union.size = 0;
		union.alignment = 0;

		const fieldNames = Object.keys(union.fields);

		// loop through to set the size of the union of the largest member field
		// and the alignment to the requirements of the largest member
		fieldNames.forEach(function (name) {
			const field = union.fields[name];
			const type = field.type;

			const size = type.indirection === 1 ? type.size : ref.sizeof.pointer;
			let alignment = type.alignment || ref.alignof.pointer;
			if (type.indirection > 1) {
				alignment = ref.alignof.pointer;
			}
			union.alignment = Math.max(union.alignment, alignment);
			union.size = Math.max(union.size, size);
		});

		// final padding
		const left = union.size % union.alignment;
		if (left > 0) {
			debug("additional padding to the end of union:", union.alignment - left);
			union.size += union.alignment - left;
		}
	}

	/**
	 * the base prototype that union type instances will inherit from.
	 */
	const proto = {};

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
	 * returns a Buffer pointing to this union data structure.
	 */
	proto.ref = function ref () {
		return this["ref.buffer"];
	};

	return Union;

};
