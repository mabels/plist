// encoding: utf-8

// = plist
//
// Copyright 2006-2010 Ben Bleything and Patrick May
// Distributed under the MIT License
//

// Plist parses Mac OS X xml property list files into ruby data structures.
//
// === Load a plist file
// This is the main point of the library:
//
//   r = Plist.parse_xml(filename_or_xml)
export default namespace Plist = {
  // Note that I don't use these two elements much:
  //
  //  + Date elements are returned as DateTime objects.
  //  + Data elements are implemented as Tempfiles
  //
  // Plist.parse_xml will blow up if it encounters a Date element.
  // If you encounter such an error, or if you have a Date element which
  // can't be parsed into a Time object, please create an issue
  // attaching your plist file at https://github.com/patsplat/plist/issues
  // so folks can implement the proper support.
  export function parse_xml(filename_or_xml: string): Result {
    const listener = Listener.new
    // parser = REXML::Parsers::StreamParser.new(File.new(filename), listener)
    const parser = StreamParser.new(filename_or_xml, listener)
    parser.parse
    return listener.result;
  }

  export class Listener {
    // include REXML::StreamListener
    public readonly result: Result;
    public readonly open: any[];

    constructor() {
      this.result = null;
      this.open   = [];
    }

    tag_start(name: string): void {
      this.open.push(new (PTag.mappings[name])());
    }

    text(contents: string): void {
      if (this.open.length > 0) {
        this.open.last.text = contents;
      }
    }

    tag_end(name: string): void {
      const last = this.open.pop();
      if (this.open.length == 0) {
        this.result = last.to_ruby;
      } else {
        this.open.last.children.push(last);
      }
    }
  }

  export class StreamParser {

    public static readonly TEXT       = /([^<]+)/;
    public static readonly XMLDECL_PATTERN = /<\?xml\s+(.*?)\?>*/m;
    public static readonly DOCTYPE_PATTERN = /\s*<!DOCTYPE\s+(.*?)(\[|>)/m;
    public static readonly COMMENT_START = /\A<!--/;
    public static readonly COMMENT_END = /.*?-->/m;

    public readonly xml: string;
    public readonly listener: any;

    constructor(plist_data_or_file: string, listener: any) {
      if (plist_data_or_file.respond_to? :read)
        this.xml = plist_data_or_file.read
      } else if (File.exist? plist_data_or_file) {
        this.xml = File.read(plist_data_or_file)
      } else {
        this.xml = plist_data_or_file
      }
      this.listener = listener;
    }

    parse(): void {
      plist_tags = PTag.mappings.keys.join('|')
      start_tag  = /<(//{plist_tags})([^>]*)>/i
      end_tag    = /<\/(//{plist_tags})[^>]*>/i

      require 'strscan'

      @scanner = StringScanner.new(@xml)
      until @scanner.eos?
        if @scanner.scan(COMMENT_START)
          @scanner.scan(COMMENT_END)
        elsif @scanner.scan(XMLDECL_PATTERN)
          encoding = parse_encoding_from_xml_declaration(@scanner[1])
          next if encoding.nil?

          // use the specified encoding for the rest of the file
          next unless String.method_defined?(:force_encoding)
          @scanner.string = @scanner.rest.force_encoding(encoding)
        elsif @scanner.scan(DOCTYPE_PATTERN)
          next
        elsif @scanner.scan(start_tag)
          @listener.tag_start(@scanner[1], nil)
          if (@scanner[2] =~ /\/$/)
            @listener.tag_end(@scanner[1])
          end
        elsif @scanner.scan(TEXT)
          @listener.text(@scanner[1])
        elsif @scanner.scan(end_tag)
          @listener.tag_end(@scanner[1])
        else
          raise "Unimplemented element"
        end
      end
    }

    private parse_encoding_from_xml_declaration(xml_declaration): void {
      return unless defined?(Encoding)

      xml_encoding = xml_declaration.match(/(?:\A|\s)encoding=(?:"(.*?)"|'(.*?)')(?:\s|\Z)/)

      return if xml_encoding.nil?

      begin
        Encoding.find(xml_encoding[1])
      rescue ArgumentError
        nil
      end
    }
  }

  class PTag {
    static _mappings = {};
    static mappings(): {} {
      return this._mappings;
    }

    static inherited(sub_class): void {
      const key = sub_class.constructor.name.toLowerCase();
      key.gsub!(/^plist::/, '')
      key.gsub!(/^p/, '')  unless key == "plist"

      this._mappings[key] = sub_class
    }

    public readonly text: string;
    public readonly children: any[];

    public constructor() {
      this.children = [];
    }
    public to_ruby() {
      throw new Error(`Unimplemented: this.constructor.name//to_ruby`);
    }
  }

  class PList extends PTag {
    public to_ruby() {
      if (children.length > 0) {
        return children[0].to_ruby
      }
      return null;
    }
  }

  class PDict < PTag
    def to_ruby
      dict = {}
      key = nil

      children.each do |c|
        if key.nil?
          key = c.to_ruby
        else
          dict[key] = c.to_ruby
          key = nil
        end
      end

      dict
    end
  end

  class PKey < PTag
    def to_ruby
      CGI.unescapeHTML(text || '')
    end
  end

  class PString < PTag
    def to_ruby
      CGI.unescapeHTML(text || '')
    end
  end

  class PArray < PTag
    def to_ruby
      children.collect do |c|
        c.to_ruby
      end
    end
  end

  class PInteger < PTag
    def to_ruby
      text.to_i
    end
  end

  class PTrue < PTag
    def to_ruby
      true
    end
  end

  class PFalse < PTag
    def to_ruby
      false
    end
  end

  class PReal < PTag
    def to_ruby
      text.to_f
    end
  end

  require 'date'
  class PDate < PTag
    def to_ruby
      DateTime.parse(text)
    end
  end

  require 'base64'
  class PData < PTag
    def to_ruby
      data = Base64.decode64(text.gsub(/\s+/, '')) unless text.nil?
      begin
        return Marshal.load(data)
      rescue Exception
        io = StringIO.new
        io.write data
        io.rewind
        return io
      end
    end
  end
}
