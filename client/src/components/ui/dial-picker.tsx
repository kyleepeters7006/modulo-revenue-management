import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface DialPickerProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  'data-testid'?: string;
}

export function DialPicker({
  value,
  onChange,
  min = -50,
  max = 50,
  step = 1,
  suffix = '',
  className,
  'data-testid': testId
}: DialPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(value.toString());
  const inputRef = useRef<HTMLInputElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);

  // Generate nearby options for the dial
  const generateOptions = (centerValue: number) => {
    const options = [];
    const range = 5; // Show 5 options on each side
    
    for (let i = -range; i <= range; i++) {
      const optionValue = centerValue + (i * step);
      if (optionValue >= min && optionValue <= max) {
        options.push(optionValue);
      }
    }
    
    return options;
  };

  const options = generateOptions(value);

  useEffect(() => {
    setDisplayValue(value.toString());
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialRef.current &&
        !dialRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleInputClick = () => {
    setIsOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayValue(e.target.value);
  };

  const handleInputBlur = () => {
    const numValue = parseFloat(displayValue);
    if (!isNaN(numValue) && numValue >= min && numValue <= max) {
      onChange(numValue);
    } else {
      setDisplayValue(value.toString());
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleInputBlur();
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setDisplayValue(value.toString());
      setIsOpen(false);
    }
  };

  const handleOptionSelect = (optionValue: number) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  // Calculate positions for dial options in a circle
  const getOptionPosition = (index: number, total: number) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2; // Start from top
    const radius = 60; // Distance from center
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return { x, y };
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
        onClick={handleInputClick}
        className={`w-20 cursor-pointer ${className}`}
        data-testid={testId}
      />
      
      {isOpen && (
        <Card
          ref={dialRef}
          className="absolute z-50 mt-2 p-4 bg-white dark:bg-gray-800 border shadow-lg"
          style={{
            width: '160px',
            height: '160px',
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        >
          <div className="relative w-full h-full">
            {/* Center value display */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-lg font-bold text-center">
                <div className="text-sm text-gray-500">Current</div>
                <div>{value}{suffix}</div>
              </div>
            </div>
            
            {/* Dial options */}
            {options.map((option, index) => {
              const { x, y } = getOptionPosition(index, options.length);
              const isSelected = option === value;
              
              return (
                <button
                  key={option}
                  className={`absolute w-8 h-8 rounded-full text-xs font-medium transition-all duration-200 ${
                    isSelected
                      ? 'bg-blue-500 text-white scale-110'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900 hover:scale-105'
                  }`}
                  style={{
                    left: `calc(50% + ${x}px - 16px)`,
                    top: `calc(50% + ${y}px - 16px)`
                  }}
                  onClick={() => handleOptionSelect(option)}
                  data-testid={`option-${option}`}
                >
                  {option}
                </button>
              );
            })}
            
            {/* Connection lines from center */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {options.map((option, index) => {
                const { x, y } = getOptionPosition(index, options.length);
                const isSelected = option === value;
                
                return (
                  <line
                    key={`line-${option}`}
                    x1="50%"
                    y1="50%"
                    x2={`calc(50% + ${x}px)`}
                    y2={`calc(50% + ${y}px)`}
                    stroke={isSelected ? '#3b82f6' : '#e5e7eb'}
                    strokeWidth={isSelected ? '2' : '1'}
                    opacity="0.3"
                  />
                );
              })}
            </svg>
          </div>
          
          {/* Instructions */}
          <div className="absolute -bottom-6 left-0 right-0 text-xs text-center text-gray-500">
            Click value to select
          </div>
        </Card>
      )}
    </div>
  );
}