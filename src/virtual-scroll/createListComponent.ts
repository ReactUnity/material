import { ReactUnity, Style, UnityEngine } from '@reactunity/renderer';
import { UGUIElements } from '@reactunity/renderer/ugui';
import memoizeOne from 'memoize-one';
import { PureComponent, ReactNode, createElement } from 'react';
import { getRTLOffsetType } from './domHelpers';
import { TimeoutID, cancelTimeout, requestTimeout } from './timer';

export type ScrollToAlign = 'auto' | 'smart' | 'center' | 'start' | 'end';

type itemSize = number | ((index: number) => number);
type Direction = 'ltr' | 'rtl';
type Layout = 'horizontal' | 'vertical';

type RenderComponentProps<T> = {
  data: T;
  index: number;
  isScrolling?: boolean;
  style: Object;
};

type RenderComponent<T> = React.ComponentType<Partial<RenderComponentProps<T>>>;

type ScrollDirection = 'forward' | 'backward';

type onItemsRenderedCallback = ({
  overscanStartIndex,
  overscanStopIndex,
  visibleStartIndex,
  visibleStopIndex,
}: {
  overscanStartIndex: number;
  overscanStopIndex: number;
  visibleStartIndex: number;
  visibleStopIndex: number;
}) => void;

type onScrollCallback = (opts: {
  scrollDirection: ScrollDirection;
  scrollOffset: number;
  scrollUpdateWasRequested: boolean;
}) => void;

type ScrollEvent = UnityEngine.Vector2;
type ScrollComponent = ReactUnity.UGUI.ScrollComponent;
type ItemStyleCache = { [index: number]: Object };

type OuterProps = {
  children: React.ReactNode;
  className: string | void;
  onScroll: (ev: ScrollEvent) => void;
  style: { [key: string]: any };
};

type InnerProps = {
  children: React.ReactNode;
  style: { [key: string]: any };
};

export type Props<T> = {
  children: RenderComponent<T>;
  className?: string;
  direction?: Direction;
  height?: number | string;
  initialScrollOffset?: number;
  innerRef?: any;
  innerElementType?: string | React.Component<InnerProps, any>;
  itemCount?: number;
  itemData?: T;
  itemKey?: (index: number, data: T) => any;
  itemSize?: itemSize;
  layout?: Layout;
  onItemsRendered?: onItemsRenderedCallback;
  onScroll?: onScrollCallback;
  outerRef?: any;
  outerElementType?: string | React.Component<OuterProps, any>;
  overscanCount?: number;
  useIsScrolling?: boolean;
  width?: number | string;
  style?: Style;
} & Omit<UGUIElements['scroll'], 'style' | 'children'>;

type State = {
  instance: any;
  isScrolling: boolean;
  scrollDirection: ScrollDirection;
  scrollOffset: number;
  scrollUpdateWasRequested: boolean;
};

type GetItemOffset = (props: Props<any>, index: number, instanceProps: any) => number;

type GetItemSize = (props: Props<any>, index: number, instanceProps: any) => number;

type GetEstimatedTotalSize = (props: Props<any>, instanceProps: any) => number;

type GetOffsetForIndexAndAlignment = (
  props: Props<any>,
  index: number,
  align: ScrollToAlign,
  scrollOffset: number,
  instanceProps: any,
) => number;

type GetStartIndexForOffset = (props: Props<any>, offset: number, instanceProps: any) => number;

type GetStopIndexForStartIndex = (props: Props<any>, startIndex: number, scrollOffset: number, instanceProps: any) => number;

type InitInstanceProps = (props: Props<any>, instance: any) => any;

type ValidateProps = (props: Props<any>) => void;

const IS_SCROLLING_DEBOUNCE_INTERVAL = 150;

const defaultItemKey = (index: number, data: any) => index;

export function createListComponent({
  getItemOffset,
  getEstimatedTotalSize,
  getItemSize,
  getOffsetForIndexAndAlignment,
  getStartIndexForOffset,
  getStopIndexForStartIndex,
  initInstanceProps,
  shouldResetStyleCacheOnItemSizeChange,
  validateProps,
}: {
  getItemOffset: GetItemOffset;
  getEstimatedTotalSize: GetEstimatedTotalSize;
  getItemSize: GetItemSize;
  getOffsetForIndexAndAlignment: GetOffsetForIndexAndAlignment;
  getStartIndexForOffset: GetStartIndexForOffset;
  getStopIndexForStartIndex: GetStopIndexForStartIndex;
  initInstanceProps: InitInstanceProps;
  shouldResetStyleCacheOnItemSizeChange: boolean;
  validateProps: ValidateProps;
}) {
  return class List<T> extends PureComponent<Props<T>, State> {
    _instanceProps: any = initInstanceProps(this.props, this);
    _outerRef?: ScrollComponent;
    _resetIsScrollingTimeoutId: TimeoutID | null = null;

    static defaultProps = {
      direction: 'ltr',
      itemData: undefined,
      layout: 'vertical',
      overscanCount: 2,
      useIsScrolling: false,
    };

    state: State = {
      instance: this,
      isScrolling: false,
      scrollDirection: 'forward',
      scrollOffset: typeof this.props.initialScrollOffset === 'number' ? this.props.initialScrollOffset : 0,
      scrollUpdateWasRequested: false,
    };

    // Always use explicit constructor for React components.
    // It produces less code after transpilation. (#26)
    // eslint-disable-next-line no-useless-constructor, @typescript-eslint/no-useless-constructor
    // biome-ignore lint/complexity/noUselessConstructor: <explanation>
    constructor(props: Props<T>) {
      super(props);
    }

    static getDerivedStateFromProps(nextProps: Props<any>, prevState: State): Partial<State> | null {
      validateSharedProps(nextProps, prevState);
      validateProps(nextProps);
      return null;
    }

    scrollTo(scrollOffset: number): void {
      scrollOffset = Math.max(0, scrollOffset);

      this.setState((prevState) => {
        if (prevState.scrollOffset === scrollOffset) {
          return null;
        }
        return {
          scrollDirection: prevState.scrollOffset < scrollOffset ? 'forward' : 'backward',
          scrollOffset: scrollOffset,
          scrollUpdateWasRequested: true,
        };
      }, this._resetIsScrollingDebounced);
    }

    scrollToItem(index: number, align: ScrollToAlign = 'auto'): void {
      const { itemCount } = this.props;
      const { scrollOffset } = this.state;

      index = Math.max(0, Math.min(index, itemCount - 1));

      this.scrollTo(getOffsetForIndexAndAlignment(this.props, index, align, scrollOffset, this._instanceProps));
    }

    componentDidMount() {
      const { initialScrollOffset, layout } = this.props;

      if (typeof initialScrollOffset === 'number' && this._outerRef != null) {
        const outerRef = this._outerRef;
        if (layout === 'horizontal') {
          outerRef.ScrollLeft = initialScrollOffset;
        } else {
          outerRef.ScrollTop = initialScrollOffset;
        }
      }

      this._callPropsCallbacks();
    }

    componentDidUpdate() {
      const { direction, layout } = this.props;
      const { scrollOffset, scrollUpdateWasRequested } = this.state;

      if (scrollUpdateWasRequested && this._outerRef != null) {
        const outerRef = this._outerRef;

        if (layout === 'horizontal') {
          if (direction === 'rtl') {
            // TRICKY According to the spec, ScrollLeft should be negative for RTL aligned elements.
            // This is not the case for all browsers though (e.g. Chrome reports values as positive, measured relative to the left).
            // So we need to determine which browser behavior we're dealing with, and mimic it.
            switch (getRTLOffsetType()) {
              case 'negative':
                outerRef.ScrollLeft = -scrollOffset;
                break;
              case 'positive-ascending':
                outerRef.ScrollLeft = scrollOffset;
                break;
              default: {
                const scrollWidth = outerRef.ScrollWidth;
                const clientWidth = outerRef.ClientWidth;
                outerRef.ScrollLeft = scrollWidth - clientWidth - scrollOffset;
                break;
              }
            }
          } else {
            outerRef.ScrollLeft = scrollOffset;
          }
        } else {
          outerRef.ScrollTop = scrollOffset;
        }
      }

      this._callPropsCallbacks();
    }

    componentWillUnmount() {
      if (this._resetIsScrollingTimeoutId !== null) {
        cancelTimeout(this._resetIsScrollingTimeoutId);
      }
    }

    render() {
      const {
        children,
        className,
        direction,
        height,
        innerRef,
        innerElementType,
        itemCount,
        itemData,
        itemKey = defaultItemKey,
        layout,
        outerElementType,
        style,
        useIsScrolling,
        width,

        // Unused
        initialScrollOffset,
        itemSize,
        onItemsRendered,
        onScroll: _,
        outerRef,
        overscanCount,
        ...rest
      } = this.props;
      const { isScrolling } = this.state;

      const isHorizontal = layout === 'horizontal';

      const onScroll = isHorizontal ? this._onScrollHorizontal : this._onScrollVertical;

      const [startIndex, stopIndex] = this._getRangeToRender();

      const items = [];
      if (itemCount > 0) {
        for (let index = startIndex; index <= stopIndex; index++) {
          items.push(
            createElement(children as any, {
              data: itemData,
              key: itemKey(index, itemData),
              index,
              isScrolling: useIsScrolling ? isScrolling : undefined,
              style: this._getItemStyle(index),
            }),
          );
        }
      }

      // Read this value AFTER items have been created,
      // So their actual sizes (if variable) are taken into consideration.
      const estimatedTotalSize = getEstimatedTotalSize(this.props, this._instanceProps);

      return createElement(
        (outerElementType || 'scroll') as any,
        {
          ...rest,
          className,
          onValueChanged: onScroll,
          ref: this._outerRefSetter,
          style: {
            position: 'relative',
            height,
            width,
            direction,
            ...style,
          },
        },
        createElement((innerElementType || 'view') as any, {
          children: items,
          ref: innerRef,
          style: {
            height: isHorizontal ? '100%' : estimatedTotalSize,
            pointerEvents: isScrolling ? 'none' : undefined,
            width: isHorizontal ? estimatedTotalSize : '100%',
          },
        }),
      );
    }

    _callOnItemsRendered: (
      overscanStartIndex: number,
      overscanStopIndex: number,
      visibleStartIndex: number,
      visibleStopIndex: number,
    ) => void = memoizeOne((overscanStartIndex: number, overscanStopIndex: number, visibleStartIndex: number, visibleStopIndex: number) =>
      (this.props.onItemsRendered as onItemsRenderedCallback)({
        overscanStartIndex,
        overscanStopIndex,
        visibleStartIndex,
        visibleStopIndex,
      }),
    );

    _callOnScroll: (scrollDirection: ScrollDirection, scrollOffset: number, scrollUpdateWasRequested: boolean) => void = memoizeOne(
      (scrollDirection: ScrollDirection, scrollOffset: number, scrollUpdateWasRequested: boolean) =>
        (this.props.onScroll as onScrollCallback)({
          scrollDirection,
          scrollOffset,
          scrollUpdateWasRequested,
        }),
    );

    _callPropsCallbacks() {
      if (typeof this.props.onItemsRendered === 'function') {
        const { itemCount } = this.props;
        if (itemCount > 0) {
          const [overscanStartIndex, overscanStopIndex, visibleStartIndex, visibleStopIndex] = this._getRangeToRender();
          this._callOnItemsRendered(overscanStartIndex, overscanStopIndex, visibleStartIndex, visibleStopIndex);
        }
      }

      if (typeof this.props.onScroll === 'function') {
        const { scrollDirection, scrollOffset, scrollUpdateWasRequested } = this.state;
        this._callOnScroll(scrollDirection, scrollOffset, scrollUpdateWasRequested);
      }
    }

    // Lazily create and cache item styles while scrolling,
    // So that pure component sCU will prevent re-renders.
    // We maintain this cache, and pass a style prop rather than index,
    // So that List can clear cached styles and force item re-render if necessary.
    _getItemStyle: (index: number) => Object = (index: number): Object => {
      const { direction, itemSize, layout } = this.props;

      const itemStyleCache = this._getItemStyleCache(
        shouldResetStyleCacheOnItemSizeChange && itemSize,
        shouldResetStyleCacheOnItemSizeChange && layout,
        shouldResetStyleCacheOnItemSizeChange && direction,
      );

      let style;
      if (itemStyleCache.hasOwnProperty(index)) {
        style = itemStyleCache[index];
      } else {
        const offset = getItemOffset(this.props, index, this._instanceProps);
        const size = getItemSize(this.props, index, this._instanceProps);

        const isHorizontal = layout === 'horizontal';

        const isRtl = direction === 'rtl';
        const offsetHorizontal = isHorizontal ? offset : 0;
        itemStyleCache[index] = style = {
          position: 'absolute',
          left: isRtl ? undefined : offsetHorizontal,
          right: isRtl ? offsetHorizontal : undefined,
          top: !isHorizontal ? offset : 0,
          height: !isHorizontal ? size : '100%',
          width: isHorizontal ? size : '100%',
        };
      }

      return style;
    };

    _getItemStyleCache: (_: any, __: any, ___?: any) => ItemStyleCache = memoizeOne((_: any, __: any, ___?: any) => ({}));

    _getRangeToRender(): [number, number, number, number] {
      const { itemCount, overscanCount } = this.props;
      const { isScrolling, scrollDirection, scrollOffset } = this.state;

      if (itemCount === 0) {
        return [0, 0, 0, 0];
      }

      const startIndex = getStartIndexForOffset(this.props, scrollOffset, this._instanceProps);

      const stopIndex = getStopIndexForStartIndex(this.props, startIndex, scrollOffset, this._instanceProps);

      // Overscan by one item in each direction so that tab/focus works.
      // If there isn't at least one extra item, tab loops back around.
      const overscanBackward = !isScrolling || scrollDirection === 'backward' ? Math.max(1, overscanCount) : 1;
      const overscanForward = !isScrolling || scrollDirection === 'forward' ? Math.max(1, overscanCount) : 1;

      return [
        Math.max(0, startIndex - overscanBackward),
        Math.max(0, Math.min(itemCount - 1, stopIndex + overscanForward)),
        startIndex,
        stopIndex,
      ];
    }

    _onScrollHorizontal = (event: ScrollEvent, sender: ScrollComponent): void => {
      const clientWidth = sender.ClientWidth;
      const scrollWidth = sender.ScrollWidth;
      const scrollLeft = sender.ScrollLeft;
      this.setState((prevState) => {
        if (prevState.scrollOffset === scrollLeft) {
          // Scroll position may have been updated by cDM/cDU,
          // In which case we don't need to trigger another render,
          // And we don't want to update state.isScrolling.
          return null;
        }

        const { direction } = this.props;

        let scrollOffset = scrollLeft;
        if (direction === 'rtl') {
          // TRICKY According to the spec, scrollLeft should be negative for RTL aligned elements.
          // This is not the case for all browsers though (e.g. Chrome reports values as positive, measured relative to the left).
          // It's also easier for this component if we convert offsets to the same format as they would be in for ltr.
          // So the simplest solution is to determine which browser behavior we're dealing with, and convert based on it.
          switch (getRTLOffsetType()) {
            case 'negative':
              scrollOffset = -scrollLeft;
              break;
            case 'positive-descending':
              scrollOffset = scrollWidth - clientWidth - scrollLeft;
              break;
          }
        }

        // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
        scrollOffset = Math.max(0, Math.min(scrollOffset, scrollWidth - clientWidth));

        return {
          isScrolling: true,
          scrollDirection: prevState.scrollOffset < scrollLeft ? 'forward' : 'backward',
          scrollOffset,
          scrollUpdateWasRequested: false,
        };
      }, this._resetIsScrollingDebounced);
    };

    _onScrollVertical = (event: ScrollEvent, sender: ScrollComponent): void => {
      const clientHeight = sender.ClientHeight;
      const scrollHeight = sender.ScrollHeight;
      const scrollTop = sender.ScrollTop;
      this.setState((prevState) => {
        if (prevState.scrollOffset === scrollTop) {
          // Scroll position may have been updated by cDM/cDU,
          // In which case we don't need to trigger another render,
          // And we don't want to update state.isScrolling.
          return null;
        }

        // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
        const scrollOffset = Math.max(0, Math.min(scrollTop, scrollHeight - clientHeight));

        return {
          isScrolling: true,
          scrollDirection: prevState.scrollOffset < scrollOffset ? 'forward' : 'backward',
          scrollOffset,
          scrollUpdateWasRequested: false,
        };
      }, this._resetIsScrollingDebounced);
    };

    _outerRefSetter = (ref: any): void => {
      const { outerRef } = this.props;

      this._outerRef = ref;

      if (typeof outerRef === 'function') {
        outerRef(ref);
      } else if (outerRef != null && typeof outerRef === 'object' && outerRef.hasOwnProperty('current')) {
        outerRef.current = ref;
      }
    };

    _resetIsScrollingDebounced = () => {
      if (this._resetIsScrollingTimeoutId !== null) {
        cancelTimeout(this._resetIsScrollingTimeoutId);
      }

      this._resetIsScrollingTimeoutId = requestTimeout(this._resetIsScrolling, IS_SCROLLING_DEBOUNCE_INTERVAL);
    };

    _resetIsScrolling = () => {
      this._resetIsScrollingTimeoutId = null;

      this.setState({ isScrolling: false }, () => {
        // Clear style cache after state update has been committed.
        // This way we don't break pure sCU for items that don't use isScrolling param.
        this._getItemStyleCache(-1, null);
      });
    };
  } as unknown as <T>(props: Props<T>) => ReactNode;
}

// NOTE: I considered further wrapping individual items with a pure ListItem component.
// This would avoid ever calling the render function for the same index more than once,
// But it would also add the overhead of a lot of components/fibers.
// I assume people already do this (render function returning a class component),
// So my doing it would just unnecessarily double the wrappers.

const validateSharedProps = ({ children, direction, height, layout, width }: Props<any>, { instance }: State): void => {
  if (process.env.NODE_ENV !== 'production') {
    const isHorizontal = layout === 'horizontal';

    switch (direction) {
      case 'ltr':
      case 'rtl':
        // Valid values
        break;
      default:
        throw Error(`An invalid "direction" prop has been specified. Value should be either "ltr" or "rtl". "${direction}" was specified.`);
    }

    switch (layout) {
      case 'horizontal':
      case 'vertical':
        // Valid values
        break;
      default:
        throw Error(
          `An invalid "layout" prop has been specified. Value should be either "horizontal" or "vertical". "${layout}" was specified.`,
        );
    }

    if (children == null) {
      throw Error(
        `An invalid "children" prop has been specified. Value should be a React component. "${children === null ? 'null' : typeof children}" was specified.`,
      );
    }

    if (isHorizontal && typeof width !== 'number') {
      throw Error(
        `An invalid "width" prop has been specified. Horizontal lists must specify a number for width. "${width === null ? 'null' : typeof width}" was specified.`,
      );
    }
    if (!isHorizontal && typeof height !== 'number') {
      throw Error(
        `An invalid "height" prop has been specified. Vertical lists must specify a number for height. "${height === null ? 'null' : typeof height}" was specified.`,
      );
    }
  }
};
